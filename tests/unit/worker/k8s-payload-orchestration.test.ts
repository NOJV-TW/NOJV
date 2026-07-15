import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import { K8sExecutor } from "../../../apps/worker/src/services/k8s-executor";

const EXEC_CONFIG = {
  namespace: "nojv-sandbox",
  image: "nojv-sandbox:test",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
};

function request(input: string): SandboxRequest {
  return {
    submissionId: "standard",
    sourceCode: "print(input())",
    language: "python",
    problemType: "full_source",
    testcases: [{ index: 0, input, output: `${input}\n`, weight: 1, isSample: false }],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 128 },
  };
}

function clients(options: { failConfigMapAttempt?: number } = {}) {
  const configMapsCreated: string[] = [];
  const configMapsDeleted: string[] = [];
  const jobsCreated: any[] = [];
  let configMapAttempt = 0;
  const coreApi = {
    createNamespacedConfigMap: vi.fn(async ({ body }: any) => {
      configMapAttempt += 1;
      if (configMapAttempt === options.failConfigMapAttempt) {
        throw new Error("injected ConfigMap create failure");
      }
      configMapsCreated.push(body.metadata.name);
    }),
    deleteNamespacedConfigMap: vi.fn(async ({ name }: any) => {
      configMapsDeleted.push(name);
    }),
    listNamespacedPod: vi.fn(async ({ labelSelector }: any) => ({
      items: [{ metadata: { name: `${String(labelSelector).split("=")[1]}-pod` } }],
    })),
    readNamespacedPodLog: vi.fn(async ({ container }: any) =>
      container === "compile"
        ? JSON.stringify({ runCommand: ["python3", "main.py"] })
        : JSON.stringify({
            rawRuns: [{ index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
            testcaseResults: [],
          }),
    ),
  } as any;
  const batchApi = {
    createNamespacedJob: vi.fn(async ({ body }: any) => {
      jobsCreated.push(body);
    }),
    readNamespacedJob: vi.fn(async () => ({ status: { succeeded: 1 } })),
    deleteNamespacedJob: vi.fn(async () => undefined),
  } as any;
  return {
    handles: { coreApi, batchApi },
    record: { configMapsCreated, configMapsDeleted, jobsCreated },
  };
}

describe("K8sExecutor sharded payload orchestration", () => {
  it("runs a multi-ConfigMap payload and removes every shard", async () => {
    const fake = clients();
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x".repeat(2 * 1024 * 1024)), {
      runId: "standard",
      signal: new AbortController().signal,
    });

    expect(fake.record.configMapsCreated).toEqual([
      "judge-standard-pm",
      "judge-standard-p0",
      "judge-standard-p1",
      "judge-standard-p2",
    ]);
    expect([...fake.record.configMapsDeleted].sort()).toEqual(
      [...fake.record.configMapsCreated].sort(),
    );
    const podSpec = fake.record.jobsCreated[0].spec.template.spec;
    expect(podSpec.initContainers.map((container: any) => container.name)).toEqual([
      "materialize",
      "compile",
    ]);
    expect(
      podSpec.volumes.find((volume: any) => volume.name === "payload").projected.sources,
    ).toHaveLength(4);
  });

  it("removes already-created shards when a later ConfigMap create fails", async () => {
    const fake = clients({ failConfigMapAttempt: 3 });
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await expect(
      executor.execute(request("x".repeat(2 * 1024 * 1024)), {
        runId: "standard",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("injected ConfigMap create failure");

    expect(fake.record.configMapsCreated).toEqual(["judge-standard-pm", "judge-standard-p0"]);
    expect([...fake.record.configMapsDeleted].sort()).toEqual(
      [...fake.record.configMapsCreated].sort(),
    );
    expect(fake.record.jobsCreated).toHaveLength(0);
  });
});
