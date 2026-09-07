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
  caseCpuRequest: "100m",
  maxParallelCases: 20,
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
    listNamespacedEvent: vi.fn(async () => ({
      items: options.blockedEvent ? [options.blockedEvent] : [],
    })),
    readNamespacedPodLog: vi.fn(async ({ container }: any) =>
      container === "prepare"
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
    readNamespacedJob: vi.fn(async () => ({
      status: options.blockedEvent ? {} : { succeeded: 1 },
    })),
    deleteNamespacedJob: vi.fn(async () => undefined),
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
        if (container === "runner") return JSON.stringify({ validatorOutcomes });
        if (container === "prepare")
          return JSON.stringify({ runCommand: ["python3", "main.py"] });
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
        if (container === "runner")
          return JSON.stringify({
            validatorOutcomes: [
              { index: 2, verdict: "AC" },
              { index: 0, verdict: "AC" },
            ],
          });
        if (container === "prepare")
          return JSON.stringify({ runCommand: ["python3", "main.py"] });
        const index = Number(container.replace("case-", ""));
        return JSON.stringify({
          rawRuns: [
            {
              index,
              stdout: "ok\n",
              stderr: "",
              exitCode: index === 1 ? 1 : 0,
              timeMs: 1,
              ...(index === 1 ? { errorVerdict: "RE" } : {}),
            },
          ],
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
        message: expect.stringContaining("nojv-sandbox/judge-log-failure-pod (prepare)"),
      });
      expect(fake.record.configMapsDeleted).toEqual(fake.record.configMapsCreated);
    },
  );

  it("ignores unrelated JSON logging after a valid runner report", async () => {
    const fake = clients();
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) =>
        container === "prepare"
          ? JSON.stringify({ runCommand: ["python3", "main.py"] })
          : JSON.stringify({
              rawRuns: [{ index: 0, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
            }) + '\n{"level":"info","message":"finished"}',
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
    expect(podSpec.initContainers.map((container: any) => container.name)).toEqual(["prepare"]);
    expect(podSpec.initContainers[0].env).toContainEqual({
      name: "SANDBOX_PHASE",
      value: "prepare",
    });
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

  it("creates one 20-case Job per wave and compiles once per wave", async () => {
    const fake = clients();
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x", 21), {
      runId: "twenty-one",
      signal: new AbortController().signal,
    });

    expect(fake.record.jobsCreated).toHaveLength(2);
    expect(fake.record.jobsCreated[0].spec.template.spec.runtimeClassName).toBe("gvisor");
    expect(fake.record.jobsCreated[0].spec.template.spec.initContainers).toHaveLength(1);
    expect(fake.record.jobsCreated[0].spec.template.spec.containers).toHaveLength(20);
    expect(
      fake.record.jobsCreated[0].spec.template.spec.containers.every(
        (container: any) => container.resources.requests.cpu === "100m",
      ),
    ).toBe(true);
    expect(fake.record.jobsCreated[1].spec.template.spec.containers).toHaveLength(1);
  });

  it("uses a succeeded Pod without waiting for the Job controller", async () => {
    const fake = clients();
    fake.handles.batchApi.readNamespacedJob
      .mockResolvedValueOnce({ status: {} })
      .mockResolvedValue({ status: { succeeded: 1 } });
    fake.handles.coreApi.listNamespacedPod.mockResolvedValue({
      items: [
        {
          metadata: { name: "judge-standard-pod" },
          status: { phase: "Succeeded", startTime: new Date() },
        },
      ],
    });
    const executor = new K8sExecutor(EXEC_CONFIG, fake.handles);

    await executor.execute(request("x"), {
      runId: "standard",
      signal: new AbortController().signal,
    });

    expect(fake.handles.batchApi.readNamespacedJob).toHaveBeenCalledTimes(1);
  });

  it("reads case logs concurrently after the Pod succeeds", async () => {
    const fake = clients();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        if (container === "prepare")
          return JSON.stringify({ runCommand: ["python3", "main.py"] });
        started.push(container);
        await gate;
        const index = Number.parseInt(container.replace("case-", ""), 10);
        return JSON.stringify({
          rawRuns: [{ index, stdout: "ok\n", stderr: "", exitCode: 0, timeMs: 1 }],
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

    expect(startedBeforeRelease.sort()).toEqual(["case-0", "case-1", "case-2"]);
  });
});
