import type { SandboxRequest } from "@nojv/core";
import { describe, expect, it, vi } from "vitest";

import {
  K8sExecutor,
  SandboxAdmissionError,
} from "../../../apps/worker/src/services/k8s-executor";

const EXEC_CONFIG = {
  namespace: "nojv-sandbox",
  image: "nojv-sandbox:test",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
  runParallelism: 1,
  runtimeClassName: "gvisor",
};

function request(input: string, testcaseCount = 1): SandboxRequest {
  return {
    submissionId: "standard",
    sourceCode: "print(input())",
    language: "python",
    problemType: "full_source",
    testcases: Array.from({ length: testcaseCount }, (_, index) => ({
      index,
      input,
      output: `${input}\n`,
      weight: 1,
      isSample: false,
    })),
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 128 },
  };
}

function clients(
  options: {
    failConfigMapAttempt?: number;
    blockedEvent?: { type: string; reason: string; message: string };
  } = {},
) {
  const configMapsCreated: string[] = [];
  const configMapsDeleted: string[] = [];
  const jobsCreated: any[] = [];
  let configMapAttempt = 0;
  const liveJobs = new Set<string>();
  const coreApi = {
    listNamespacedResourceQuota: vi.fn(async () => ({ items: [] })),
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
    listNamespacedPod: vi.fn(async ({ labelSelector }: any) => {
      const name = String(labelSelector).split("=")[1]!;
      return {
        items: liveJobs.has(name)
          ? [
              {
                metadata: {
                  name: `${name}-pod`,
                  uid: `${name}-pod-uid`,
                  ownerReferences: [
                    { apiVersion: "batch/v1", kind: "Job", name, uid: `${name}-uid` },
                  ],
                },
                status: {
                  initContainerStatuses: [
                    { name: "run", state: { terminated: { exitCode: 0 } } },
                  ],
                  containerStatuses: [
                    { name: "judge", state: { terminated: { exitCode: 0 } } },
                  ],
                },
              },
            ]
          : [],
      };
    }),
    listNamespacedEvent: vi.fn(async () => ({
      items: options.blockedEvent ? [options.blockedEvent] : [],
    })),
    readNamespacedPodLog: vi.fn(async ({ container }: any) => {
      if (container === "judge")
        return JSON.stringify({ validatorOutcomes: [{ index: 0, verdict: "AC" }] });
      return JSON.stringify({
        rawRuns: [{ index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
        testcaseResults: [],
      });
    }),
  } as any;
  const batchApi = {
    createNamespacedJob: vi.fn(async ({ body }: any) => {
      jobsCreated.push(body);
      liveJobs.add(body.metadata.name);
    }),
    readNamespacedJob: vi.fn(async ({ name }: any) => {
      if (!liveJobs.has(name)) throw { code: 404 };
      return {
        metadata: { name, uid: `${name}-uid` },
        status: options.blockedEvent ? {} : { succeeded: 1 },
      };
    }),
    deleteNamespacedJob: vi.fn(async ({ name }: any) => {
      liveJobs.delete(name);
    }),
  } as any;
  const watch = {
    watch: vi.fn(
      async (_path: string, _query: unknown, _callback: unknown, done: (err: null) => void) => {
        queueMicrotask(() => done(null));
        return new AbortController();
      },
    ),
  } as any;
  return {
    handles: { coreApi, batchApi, watch },
    record: { configMapsCreated, configMapsDeleted, jobsCreated },
  };
}

describe("K8sExecutor sharded payload orchestration", () => {
  it("retains payloads after delete acceptance until the owned Pod actually disappears", async () => {
    vi.useFakeTimers();
    try {
      const fake = clients();
      const deleteJob = fake.handles.batchApi.deleteNamespacedJob.getMockImplementation();
      fake.handles.batchApi.deleteNamespacedJob.mockResolvedValue(undefined);
      const execution = new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request("ok"), {
        runId: "termination-barrier",
        signal: new AbortController().signal,
      });
      const result = expect(execution).resolves.toBeDefined();
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.handles.batchApi.deleteNamespacedJob).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            propagationPolicy: "Foreground",
            preconditions: { uid: "judge-termination-barrier-uid" },
          },
        }),
      );
      expect(fake.record.configMapsCreated.length).toBeGreaterThan(0);
      expect(fake.record.configMapsDeleted).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fake.record.configMapsDeleted).toEqual([]);
      await deleteJob({ name: "judge-termination-barrier" });
      await vi.advanceTimersByTimeAsync(500);
      await result;
      expect(fake.record.configMapsDeleted).toEqual(fake.record.configMapsCreated);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins standard and checker images per request without changing the executor default", async () => {
    const fake = clients();
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);
    const pinnedImage = "registry.example.com/sandbox@sha256:original";
    await executor.execute(
      {
        ...request("ok"),
        sandboxImage: pinnedImage,
        judgeType: "checker",
        judgeConfig: { checkerScript: "accept()", checkerLanguage: "python" },
      },
      { runId: "pinned", signal: new AbortController().signal },
    );
    expect(fake.record.jobsCreated).toHaveLength(1);
    for (const job of fake.record.jobsCreated) {
      const spec = job.spec.template.spec;
      expect(
        [...spec.initContainers, ...spec.containers].every(
          (container) => container.image === pinnedImage,
        ),
      ).toBe(true);
    }
    await executor.execute(request("ok"), {
      runId: "current",
      signal: new AbortController().signal,
    });
    const current = fake.record.jobsCreated[1].spec.template.spec;
    expect(
      [...current.initContainers, ...current.containers].every(
        (container) => container.image === EXEC_CONFIG.image,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "duplicate",
      [
        { index: 0, verdict: "WA" },
        { index: 0, verdict: "AC" },
      ],
    ],
    ["missing", []],
    ["unexpected", [{ index: 1, verdict: "AC" }]],
  ])("rejects %s validator case indices", async (_name, validatorOutcomes) => {
    const fake = clients();
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        if (container === "judge") return JSON.stringify({ validatorOutcomes });
        return JSON.stringify({
          rawRuns: [{ index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
        });
      },
    );
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(
      {
        ...request("ok"),
        judgeType: "checker",
        judgeConfig: { checkerScript: "accept()", checkerLanguage: "python" },
      },
      { runId: "invalid-validator", signal: new AbortController().signal },
    );
    expect(result.testcaseResults[0]).toMatchObject({
      verdict: "SE",
      staffFeedback: expect.stringContaining("expected testcase indices exactly once"),
    });
  });

  it("validates the sparse set of clean runs independently of result order", async () => {
    const fake = clients();
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        if (container === "judge")
          return JSON.stringify({
            validatorOutcomes: [
              { index: 2, verdict: "AC" },
              { index: 0, verdict: "AC" },
            ],
          });
        return JSON.stringify({
          rawRuns: [2, 1, 0].map((index) => ({
            index,
            stdout: "ok\n",
            stderr: "",
            exitCode: index === 1 ? 1 : 0,
            timeMs: 1,
            ...(index === 1 ? { errorVerdict: "RE" } : {}),
          })),
        });
      },
    );
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(
      {
        ...request("ok", 3),
        judgeType: "checker",
        judgeConfig: { checkerScript: "accept()", checkerLanguage: "python" },
      },
      { runId: "sparse-validator", signal: new AbortController().signal },
    );
    expect(result.testcaseResults.map(({ verdict }) => verdict)).toEqual(["AC", "RE", "AC"]);
  });

  it.each([403, 503])(
    "preserves log API %i errors for infrastructure retry",
    async (status) => {
      const fake = clients();
      const failure = new Error(`Kubernetes API ${String(status)}`);
      fake.handles.coreApi.readNamespacedPodLog.mockRejectedValue(failure);
      const execution = new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request("ok"), {
        runId: "log-failure",
        signal: new AbortController().signal,
      });
      await expect(execution).rejects.toMatchObject({
        name: "SandboxInfrastructureError",
        cause: failure,
        message: expect.stringContaining("nojv-sandbox/judge-log-failure-pod (run)"),
      });
      expect(fake.record.configMapsDeleted).toEqual(fake.record.configMapsCreated);
    },
  );

  it("ignores unrelated JSON logging after a valid runner report", async () => {
    const fake = clients();
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        if (container === "judge")
          return (
            JSON.stringify({ validatorOutcomes: [{ index: 0, verdict: "AC" }] }) +
            '\n{"level":"info","message":"finished"}'
          );
        return (
          JSON.stringify({
            rawRuns: [{ index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
          }) + '\n{"level":"info","message":"finished"}'
        );
      },
    );
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request("ok"), {
      runId: "json-log",
      signal: new AbortController().signal,
    });
    expect(result.testcaseResults[0]!.verdict).toBe("AC");
  });

  it("runs a multi-ConfigMap payload and removes every shard", async () => {
    const fake = clients();
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x".repeat(2 * 1024 * 1024)), {
      runId: "standard",
      signal: new AbortController().signal,
    });

    expect([...fake.record.configMapsCreated].sort()).toEqual(
      ["judge", "run"].flatMap((part) =>
        ["p0", "p1", "p2", "pm"].map((shard) => `judge-standard-${part}-${shard}`),
      ),
    );
    expect([...fake.record.configMapsDeleted].sort()).toEqual(
      [...fake.record.configMapsCreated].sort(),
    );
    const podSpec = fake.record.jobsCreated[0].spec.template.spec;
    expect(podSpec.initContainers.map((container: any) => container.name)).toEqual(["run"]);
    expect(podSpec.initContainers[0].env).toContainEqual({
      name: "SANDBOX_PHASE",
      value: "run-stage",
    });
    for (const name of ["run-payload", "judge-payload"])
      expect(
        podSpec.volumes.find((volume: any) => volume.name === name).projected.sources,
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

    expect(fake.record.configMapsCreated).not.toContain("judge-standard-run-p1");
    expect(fake.record.configMapsCreated.length).toBeGreaterThan(0);
    expect([...fake.record.configMapsDeleted].sort()).toEqual(
      [...fake.record.configMapsCreated].sort(),
    );
    expect(fake.record.jobsCreated).toHaveLength(0);
  });

  it("fails a deterministic FailedCreate admission event without waiting for the Job deadline", async () => {
    const fake = clients({
      blockedEvent: {
        type: "Warning",
        reason: "FailedCreate",
        message: "forbidden: maximum memory usage per Container is 1Gi, but limit is 1088Mi",
      },
    });
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);
    const startedAt = Date.now();

    await expect(
      executor.execute(request("small"), {
        runId: "admission",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(SandboxAdmissionError);

    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(fake.record.jobsCreated).toHaveLength(1);
  });

  it("runs every case of a request in one Job with one run container", async () => {
    const fake = clients();
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x", 21), {
      runId: "twenty-one",
      signal: new AbortController().signal,
    });

    expect(fake.record.jobsCreated).toHaveLength(1);
    const spec = fake.record.jobsCreated[0].spec.template.spec;
    expect(spec.runtimeClassName).toBe("gvisor");
    expect(spec.initContainers.map((container: any) => container.name)).toEqual(["run"]);
    expect(spec.containers.map((container: any) => container.name)).toEqual(["judge"]);
    expect(spec.initContainers[0].resources.requests.cpu).toBe("1");
  });

  it("lowers run parallelism until the run container fits the memory ceiling", async () => {
    const fake = clients();
    const executor = new K8sExecutor(
      { ...EXEC_CONFIG, runParallelism: 4, maxMemoryMb: 1536 },
      fake.handles,
    );
    await executor.execute(
      { ...request("x", 3), limits: { timeoutMs: 1_000, memoryMb: 1024 } },
      { runId: "big-memory", signal: new AbortController().signal },
    );
    const run = fake.record.jobsCreated[0].spec.template.spec.initContainers[0];
    expect(run.resources.limits).toEqual({ cpu: "1", memory: "1216Mi" });
  });

  it("uses a succeeded Pod without waiting for the Job controller", async () => {
    const fake = clients();
    fake.handles.batchApi.readNamespacedJob.mockResolvedValueOnce({
      metadata: { uid: "judge-standard-uid" },
      status: {},
    });
    const listPods = fake.handles.coreApi.listNamespacedPod.getMockImplementation();
    fake.handles.coreApi.listNamespacedPod.mockImplementation(async (args: any) => {
      const response = await listPods(args);
      for (const pod of response.items)
        pod.status = { phase: "Succeeded", startTime: new Date() };
      return response;
    });
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x"), {
      runId: "standard",
      signal: new AbortController().signal,
    });

    expect(fake.handles.batchApi.readNamespacedJob).toHaveBeenCalledTimes(2);
  });

  it("reads the run and judge logs concurrently after the Pod succeeds", async () => {
    const fake = clients();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        started.push(container);
        await gate;
        if (container === "judge")
          return JSON.stringify({
            validatorOutcomes: [0, 1, 2].map((index) => ({ index, verdict: "AC" })),
          });
        return JSON.stringify({
          rawRuns: [0, 1, 2].map((index) => ({
            index,
            stdout: "ok\n",
            stderr: "",
            exitCode: 0,
            timeMs: 1,
          })),
          testcaseResults: [],
        });
      },
    );
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);
    const execution = executor.execute(request("x", 3), {
      runId: "parallel-logs",
      signal: new AbortController().signal,
    });

    await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
    const startedBeforeRelease = [...started];
    release();
    await execution;

    expect(startedBeforeRelease.sort()).toEqual(["judge", "run"]);
  });
});
