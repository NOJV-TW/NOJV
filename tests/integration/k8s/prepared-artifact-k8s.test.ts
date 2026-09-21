import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";
import type { RawCaseRun, SandboxRequest } from "@nojv/core";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  K8sExecutor,
  type K8sClientHandles,
} from "../../../apps/worker/src/services/k8s-executor";
import {
  assertK8sIntegrationOptIn,
  assertSafeK8sIntegrationTarget,
} from "../../setup/k8s-integration-target";

const require = createRequire(import.meta.url);
let clients: K8sClientHandles;
let namespace: string;
let nodeName: string;

describe.runIf(process.env.NOJV_TEST_RUNTIME_CLASS === "gvisor")(
  "K8s prepared artifacts with gVisor",
  () => {
    beforeAll(async () => {
      assertK8sIntegrationOptIn(process.env);
      const lib = require("@kubernetes/client-node") as typeof k8s;
      const config = new lib.KubeConfig();
      config.loadFromDefault();
      namespace = assertSafeK8sIntegrationTarget({
        env: process.env,
        context: config.getCurrentContext(),
        server: config.getCurrentCluster()?.server ?? "",
      }).namespace;
      const runtime = await config
        .makeApiClient(lib.NodeV1Api)
        .readRuntimeClass({ name: "gvisor" });
      expect(runtime.handler).toBe("runsc");
      const coreApi = config.makeApiClient(lib.CoreV1Api);
      const nodes = await coreApi.listNode({ labelSelector: "nojv-role=sandbox" });
      const node = nodes.items.find(
        (item) =>
          !item.spec?.unschedulable &&
          item.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True"),
      );
      if (!node?.metadata?.name) throw new Error("No Ready sandbox test node");
      nodeName = node.metadata.name;
      clients = {
        coreApi,
        batchApi: config.makeApiClient(lib.BatchV1Api),
        networkingApi: config.makeApiClient(lib.NetworkingV1Api),
        storageApi: config.makeApiClient(lib.StorageV1Api),
        watch: new lib.Watch(config),
      };
    });

    it.each([
      { mode: "standard" as const, count: 20 },
      { mode: "checker" as const, count: 5 },
    ])(
      "$mode: one compilation across $count isolated cases, then no owned API resources",
      { timeout: 240_000 },
      async ({ mode, count }) => {
        const runId = randomUUID();
        const executor = new K8sExecutor(
          {
            namespace,
            image: process.env.NOJV_TEST_SANDBOX_IMAGE ?? "nojv-sandbox:local",
            cpuRequest: "1",
            cpuLimit: "1",
            memoryRequest: "192Mi",
            memoryLimit: "192Mi",
            runtimeClassName: "gvisor",
            admissionNode: nodeName,
            artifactStorageClassName: "local-path",
            maxParallelCases: 4,
          },
          clients,
        );
        const request: SandboxRequest = {
          submissionId: runId,
          language: "cpp",
          problemType: "full_source",
          sourceCode: `#include <fstream>
#include <iostream>
int main() {
  if (std::ifstream("/tmp/prior-case").good()) return 10;
  std::ofstream("/tmp/prior-case") << "private";
  std::ofstream artifact("/artifact/tampered");
  if (artifact.good()) return 11;
  int n; std::cin >> n; std::cout << n * 2 << '\\n';
}`,
          judgeType: mode,
          judgeConfig:
            mode === "checker"
              ? {
                  checkerLanguage: "python",
                  checkerScript:
                    'if team_output.split() == judge_answer.split():\n    accept("match")\nelse:\n    wrong("mismatch")\n',
                }
              : {},
          limits: { timeoutMs: 5000, memoryMb: 128 },
          testcases: Array.from({ length: count }, (_, index) => ({
            index,
            input: `${index}\n`,
            output: `${index * 2}\n`,
            weight: 1,
            isSample: false,
          })),
        };
        const execution = { runId, signal: new AbortController().signal };
        const submissions = vi.spyOn(clients.batchApi, "createNamespacedJob");
        try {
          const prepared = await executor.prepareAttempt(request, execution);
          expect(prepared.compilationError).toBeUndefined();
          expect(prepared.artifact).toBeDefined();
          if (!prepared.artifact) throw new Error("No published artifact");
          const rawRuns: RawCaseRun[] = [];
          for (let offset = 0; offset < count; offset += 4) {
            const indices = request.testcases.slice(offset, offset + 4).map((tc) => tc.index);
            const wave = await executor.executePreparedWave(
              request,
              execution,
              prepared.artifact,
              indices,
            );
            expect(wave.rawRuns).toHaveLength(indices.length);
            rawRuns.push(...(wave.rawRuns ?? []));
            await executor.cleanupRun(runId, true);
          }
          expect(new Set(rawRuns.map((run) => run.index)).size).toBe(count);
          const result = await executor.finishPreparedAttempt(request, execution, rawRuns);
          expect(result.testcaseResults).toHaveLength(count);
          expect(result.testcaseResults.map((tc) => tc.verdict)).toEqual(
            Array.from({ length: count }, () => "AC"),
          );
          const manifests = submissions.mock.calls.map(([call]) => call.body);
          expect(
            manifests.filter((job) => job.metadata?.name?.endsWith("-prepare")),
          ).toHaveLength(1);
          expect(
            manifests
              .flatMap((job) => job.spec?.template.spec?.initContainers ?? [])
              .filter((container) => container.name === "prepare"),
          ).toHaveLength(1);
          expect(manifests.every((job) => !job.spec?.template.spec?.nodeName)).toBe(true);
        } finally {
          submissions.mockRestore();
          await executor.cleanupRun(runId);
        }
        const inventories = await Promise.all([
          clients.coreApi.listNamespacedPod({ namespace }),
          clients.batchApi.listNamespacedJob({ namespace }),
          clients.coreApi.listNamespacedConfigMap({ namespace }),
          clients.coreApi.listNamespacedPersistentVolumeClaim({ namespace }),
        ]);
        for (const inventory of inventories)
          expect(
            inventory.items.filter((item) => item.metadata?.name?.includes(runId)),
          ).toEqual([]);
      },
    );
  },
);
