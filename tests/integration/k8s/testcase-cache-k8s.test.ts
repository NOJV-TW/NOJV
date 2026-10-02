import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import type * as k8s from "@kubernetes/client-node";
import { beforeAll, describe, expect, it } from "vitest";

import type { SandboxRequest, SandboxTestcase, SandboxTestcaseObject } from "@nojv/core";

import {
  createKubeConfig,
  K8sExecutor,
  type K8sExecutorConfig,
} from "../../../apps/worker/src/sandbox/kubernetes/executor.js";
import { buildPayloadConfigMaps } from "../../../apps/worker/src/sandbox/kubernetes/payload.js";
import {
  HARDENED_CONTAINER_SECURITY_CONTEXT,
  SANDBOX_POD_SECURITY_CONTEXT,
} from "../../../apps/worker/src/sandbox/kubernetes/pod-spec.js";
import {
  buildJudgePayload,
  buildRunPayload,
} from "../../../apps/worker/src/sandbox/shared/stage-payload.js";
import {
  collectTestcaseCache,
  TESTCASE_CACHE_IDLE_TTL_MS,
} from "../../../apps/worker/src/sandbox/kubernetes/testcase-cache-gc.js";
import {
  assertK8sIntegrationOptIn,
  assertSafeK8sIntegrationTarget,
} from "../../setup/k8s-integration-target.js";

const require = createRequire(import.meta.url);

const SANDBOX_IMAGE = process.env.NOJV_TEST_SANDBOX_IMAGE ?? "nojv-sandbox:local";
const CASES = 30;
const TOKENS_PER_CASE = 70_000;
const REVERSE_SOLUTION =
  "import sys\ntokens = sys.stdin.read().split()\nsys.stdout.write(' '.join(reversed(tokens)) + '\\n')\n";
const FORWARD_SOLUTION =
  "import sys\ntokens = sys.stdin.read().split()\nsys.stdout.write(' '.join(tokens) + '\\n')\n";

let coreApi: k8s.CoreV1Api;
let batchApi: k8s.BatchV1Api;
let watch: k8s.Watch;
let namespace = "";

beforeAll(async () => {
  assertK8sIntegrationOptIn(process.env);
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const kc = createKubeConfig();
  kc.loadFromDefault();
  namespace = assertSafeK8sIntegrationTarget({
    env: process.env,
    context: kc.getCurrentContext(),
    server: kc.getCurrentCluster()?.server ?? "",
  }).namespace;
  coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
  batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
  watch = new k8sLib.Watch(kc);
  await coreApi.listNamespacedPod({ namespace });
}, 30_000);

function largeTestcases(seed: number): (SandboxTestcase & { input: string; output: string })[] {
  let state = seed;
  const next = () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) & 0x7fffffff;
    return 1_000_000 + (state % 9_000_000);
  };
  return Array.from({ length: CASES }, (_, index) => {
    const tokens = Array.from({ length: TOKENS_PER_CASE }, () => String(next()));
    return {
      index,
      input: `${tokens.join(" ")}\n`,
      output: `${tokens.reverse().join(" ")}\n`,
      weight: 1,
      isSample: false,
    };
  });
}

function request(
  submissionId: string,
  sourceCode: string,
  testcases: SandboxTestcase[],
): SandboxRequest {
  return {
    submissionId,
    sourceCode,
    language: "python",
    problemType: "full_source",
    testcases,
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 5_000, memoryMb: 256 },
  };
}

function recordingClients() {
  const creates: { name: string; status: "created" | "exists" | "failed" }[] = [];
  const jobCreatedAt = new Map<string, number>();
  const core = new Proxy(coreApi, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== "createNamespacedConfigMap" || typeof value !== "function") return value;
      return async (params: { body: k8s.V1ConfigMap }) => {
        const name = params.body.metadata?.name ?? "";
        try {
          const result: unknown = await (value as (p: unknown) => Promise<unknown>).call(
            target,
            params,
          );
          creates.push({ name, status: "created" });
          return result;
        } catch (error) {
          creates.push({
            name,
            status: (error as { code?: number }).code === 409 ? "exists" : "failed",
          });
          throw error;
        }
      };
    },
  });
  const batch = new Proxy(batchApi, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== "createNamespacedJob" || typeof value !== "function") return value;
      return (params: { body: k8s.V1Job }) => {
        jobCreatedAt.set(params.body.metadata?.name ?? "", Date.now());
        return (value as (p: unknown) => Promise<unknown>).call(target, params);
      };
    },
  });
  return { core, batch, creates, jobCreatedAt };
}

async function cacheIndexes(): Promise<k8s.V1ConfigMap[]> {
  return (
    await coreApi.listNamespacedConfigMap({
      namespace,
      labelSelector: "nojv-testcase-cache=index",
    })
  ).items;
}

async function cacheShardCount(): Promise<number> {
  const k8sLib = require("@kubernetes/client-node") as typeof k8s;
  const list = await coreApi.listNamespacedConfigMap(
    { namespace, labelSelector: "nojv-testcase-cache=shard", limit: 500 },
    k8sLib.setHeaderOptions(
      "Accept",
      "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1",
    ),
  );
  return (list.items as k8s.V1ConfigMap[] | null)?.length ?? 0;
}

async function pinTestcases(directory: string, testcases: SandboxTestcase[]) {
  const pin = async (name: string, content: string): Promise<SandboxTestcaseObject> => {
    const body = Buffer.from(content, "utf8");
    const key = path.join(directory, name);
    await fs.writeFile(key, body);
    return {
      key,
      sha256: createHash("sha256").update(body).digest("hex"),
      size: body.byteLength,
    };
  };
  return Promise.all(
    testcases.map(async (testcase) => ({
      ...testcase,
      input: await pin(`${String(testcase.index)}.in`, testcase.input as string),
      output: await pin(`${String(testcase.index)}.out`, testcase.output as string),
    })),
  );
}

async function oldInlinePayloadMs(prefix: string, testcases: SandboxTestcase[]) {
  const stage = request(prefix, REVERSE_SOLUTION, testcases);
  const configMaps = [
    ...buildPayloadConfigMaps(`${prefix}-run`, namespace, buildRunPayload(stage, 1)),
    ...buildPayloadConfigMaps(`${prefix}-judge`, namespace, buildJudgePayload(stage)),
  ];
  const startedAt = Date.now();
  try {
    const results = await Promise.allSettled(
      configMaps.map((body) => coreApi.createNamespacedConfigMap({ namespace, body })),
    );
    const failed = results.filter((result) => result.status === "rejected");
    return {
      ms: Date.now() - startedAt,
      objects: configMaps.length,
      failed: failed.length,
      error: failed[0] ? String((failed[0] as PromiseRejectedResult).reason) : undefined,
    };
  } finally {
    for (const configMap of configMaps)
      await coreApi
        .deleteNamespacedConfigMap({ namespace, name: configMap.metadata?.name ?? "" })
        .catch((error: unknown) => {
          if ((error as { code?: number }).code !== 404) throw error;
        });
  }
}

async function deleteCache(): Promise<void> {
  await Promise.allSettled(
    (await cacheIndexes()).map((index) =>
      coreApi.deleteNamespacedConfigMap({
        namespace,
        name: index.metadata?.name ?? "",
        body: { propagationPolicy: "Background" },
      }),
    ),
  );
}

describe("K8s judge — cached testcase payloads", () => {
  it(
    "judges concurrent submissions of a 30-case, 30+ MB problem from one cached copy and collects it afterwards",
    { timeout: 1_200_000 },
    async () => {
      const run = `cache-${Date.now().toString(36)}`;
      const testcases = largeTestcases(Date.now() % 1_000_003);
      const bytes = testcases.reduce(
        (sum, { input, output }) => sum + Buffer.byteLength(input) + Buffer.byteLength(output),
        0,
      );
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nojv-cache-k8s-"));
      const pinned = await pinTestcases(directory, testcases);
      let bytesRead = 0;
      const readTestcase = async ({ key }: SandboxTestcaseObject) => {
        const body = await fs.readFile(key);
        bytesRead += body.byteLength;
        return body;
      };
      expect(testcases).toHaveLength(CASES);
      expect(new Set(testcases.map(({ input }) => input)).size).toBe(CASES);
      expect(bytes).toBeGreaterThan(30 * 1024 * 1024);
      await deleteCache();

      const baseline = [
        await oldInlinePayloadMs(`${run}-old1`, testcases),
        ...(await Promise.all(
          [2, 3, 4, 5].map((n) => oldInlinePayloadMs(`${run}-old${String(n)}`, testcases)),
        )),
      ];

      console.info(JSON.stringify({ oldInlinePayload: baseline }));

      const recording = recordingClients();
      const executor = new K8sExecutor(
        {
          namespace,
          image: SANDBOX_IMAGE,
          cpuRequest: "100m",
          cpuLimit: "500m",
          memoryRequest: "128Mi",
          memoryLimit: "512Mi",
          readTestcase,
          ...(process.env.NOJV_TEST_RUNTIME_CLASS
            ? { runtimeClassName: process.env.NOJV_TEST_RUNTIME_CLASS }
            : {}),
        } satisfies K8sExecutorConfig,
        { coreApi: recording.core, batchApi: recording.batch, watch },
      );
      const judge = async (id: string, source: string) => {
        const startedAt = Date.now();
        const result = await executor.execute(request(id, source, pinned), {
          runId: id,
          signal: new AbortController().signal,
        });
        const jobAt = recording.jobCreatedAt.get(`judge-${id}`);
        return { id, result, payloadMs: jobAt === undefined ? null : jobAt - startedAt };
      };

      const cold = await Promise.all([
        judge(`${run}-ac1`, REVERSE_SOLUTION),
        judge(`${run}-ac2`, REVERSE_SOLUTION),
        judge(`${run}-ac3`, REVERSE_SOLUTION),
        judge(`${run}-wa1`, FORWARD_SOLUTION),
      ]);
      const coldBytesRead = bytesRead;
      bytesRead = 0;
      const warm = await judge(`${run}-ac4`, REVERSE_SOLUTION);
      expect(coldBytesRead).toBe(bytes);
      expect(bytesRead).toBe(0);
      await fs.rm(directory, { recursive: true, force: true });

      for (const { id, result } of [...cold, warm]) {
        expect(result.compilationError).toBeUndefined();
        expect(result.testcaseResults).toHaveLength(CASES);
        const expected = id.includes("-wa") ? "WA" : "AC";
        expect(result.testcaseResults.map(({ verdict }) => verdict)).toEqual(
          Array.from({ length: CASES }, () => expected),
        );
      }

      const cacheCreates = recording.creates.filter(({ name }) => name.startsWith("tc-"));
      const createdNames = cacheCreates
        .filter(({ status }) => status === "created")
        .map(({ name }) => name);
      expect(cacheCreates.filter(({ status }) => status === "failed")).toEqual([]);
      expect(new Set(createdNames).size).toBe(createdNames.length);
      const indexes = await cacheIndexes();
      expect(
        indexes.map((index) => index.metadata?.labels?.["nojv-testcase-role"]).sort(),
      ).toEqual(["answer", "input"]);
      const shardCount = await cacheShardCount();
      expect(createdNames).toHaveLength(indexes.length + shardCount);
      for (const index of indexes)
        expect(index.metadata?.annotations?.["nojv-testcase-state"]).toBe("ready");
      expect(
        recording.creates.filter(
          ({ name, status }) => name.startsWith("tc-") && status === "created",
        ),
      ).toHaveLength(createdNames.length);

      const leftovers = (
        await coreApi.listNamespacedConfigMap({
          namespace,
          labelSelector: "!nojv-testcase-cache",
        })
      ).items.filter(({ metadata }) => metadata?.name?.startsWith(`judge-${run}`));
      expect(leftovers).toEqual([]);
      const jobs = (await batchApi.listNamespacedJob({ namespace })).items.filter(
        ({ metadata }) => metadata?.name?.startsWith(`judge-${run}`),
      );
      expect(jobs).toEqual([]);

      const anyShard = `${indexes[0]?.metadata?.name ?? ""}-${(indexes[0]?.metadata?.uid ?? "").replaceAll("-", "").slice(0, 16)}-0`;
      const holder = `${run}-holder`;
      await coreApi.createNamespacedPod({
        namespace,
        body: {
          metadata: { name: holder },
          spec: {
            restartPolicy: "Never",
            terminationGracePeriodSeconds: 0,
            securityContext: SANDBOX_POD_SECURITY_CONTEXT,
            containers: [
              {
                name: "holder",
                securityContext: HARDENED_CONTAINER_SECURITY_CONTEXT,
                image: SANDBOX_IMAGE,
                imagePullPolicy: "Never",
                command: ["node", "-e", "setInterval(() => {}, 1000)"],
                resources: {
                  requests: { cpu: "100m", memory: "64Mi" },
                  limits: { cpu: "100m", memory: "128Mi" },
                },
                volumeMounts: [{ name: "cached", mountPath: "/cached", readOnly: true }],
              },
            ],
            volumes: [
              { name: "cached", projected: { sources: [{ configMap: { name: anyShard } }] } },
            ],
          },
        },
      });
      const later = Date.now() + TESTCASE_CACHE_IDLE_TTL_MS + 60_000;
      try {
        const guarded = await collectTestcaseCache(coreApi, namespace, later);
        expect(guarded.inUse).toEqual([indexes[0]?.metadata?.name]);
        expect(guarded.deleted).toEqual([indexes[1]?.metadata?.name]);
      } finally {
        await coreApi.deleteNamespacedPod({ namespace, name: holder, gracePeriodSeconds: 0 });
      }
      await expect
        .poll(
          async () =>
            (await coreApi.listNamespacedPod({ namespace })).items.some(
              ({ metadata }) => metadata?.name === holder,
            ),
          { timeout: 60_000, interval: 1_000 },
        )
        .toBe(false);
      const collected = await collectTestcaseCache(coreApi, namespace, later);
      expect(collected.deleted).toEqual([indexes[0]?.metadata?.name]);
      await expect
        .poll(async () => (await cacheIndexes()).length + (await cacheShardCount()), {
          timeout: 120_000,
          interval: 2_000,
        })
        .toBe(0);

      console.info(
        JSON.stringify({
          testcaseBytes: bytes,
          cachedObjects: createdNames.length,
          oldInlinePayload: baseline,
          newColdConcurrent: cold.map(({ id, payloadMs }) => ({ id, payloadMs })),
          newWarm: { id: warm.id, payloadMs: warm.payloadMs },
        }),
      );
    },
  );
});
