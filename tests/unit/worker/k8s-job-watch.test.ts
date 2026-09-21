import { afterEach, describe, expect, it, vi } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import {
  K8sExecutor,
  SandboxBackpressureError,
  SandboxInfrastructureError,
} from "../../../apps/worker/src/services/k8s-executor";

afterEach(() => vi.useRealTimers());

const QUOTA_MESSAGE =
  'Error creating: pods "judge-example" is forbidden: exceeded quota: sandbox-quota, requested: requests.cpu=2, used: requests.cpu=4, limited: requests.cpu=4';

const EXEC_CONFIG = {
  namespace: "nojv-sandbox",
  image: "nojv-sandbox:test",
  cpuRequest: "100m",
  cpuLimit: "1",
  memoryRequest: "128Mi",
  memoryLimit: "256Mi",
  runtimeClassName: "gvisor",
};

function request(): SandboxRequest {
  return {
    submissionId: "watch-test",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    testcases: [{ index: 0, input: "", output: "1\n", weight: 1, isSample: false }],
    judgeType: "standard",
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 128 },
  };
}

function clients(options: {
  readJob: () => any;
  watch: (
    path: string,
    callback: (phase: string, object: unknown) => void,
    done: (err: unknown) => void,
  ) => void;
}) {
  const controllers: AbortController[] = [];
  const coreApi = {
    createNamespacedConfigMap: vi.fn(async () => undefined),
    deleteNamespacedConfigMap: vi.fn(async () => undefined),
    listNamespacedPod: vi.fn(async () => ({
      metadata: { resourceVersion: "pod-rv-1" },
      items: [{ metadata: { name: "watch-test-pod" }, status: {} }],
    })),
    readNamespacedPodLog: vi.fn(async ({ container }: { container: string }) =>
      container === "prepare"
        ? JSON.stringify({ runCommand: ["python3", "main.py"] })
        : JSON.stringify({
            rawRuns: [{ index: 0, stdout: "1\n", stderr: "", exitCode: 0, timeMs: 1 }],
            testcaseResults: [],
          }),
    ),
  } as any;
  const batchApi = {
    createNamespacedJob: vi.fn(async () => undefined),
    deleteNamespacedJob: vi.fn(async () => undefined),
    readNamespacedJob: vi.fn(async () => options.readJob()),
  } as any;
  const watch = {
    watch: vi.fn(
      async (
        path: string,
        _query: unknown,
        callback: (phase: string, object: unknown) => void,
        done: (err: unknown) => void,
      ) => {
        const controller = new AbortController();
        controllers.push(controller);
        options.watch(path, callback, done);
        return controller;
      },
    ),
  } as any;
  return { handles: { coreApi, batchApi, watch }, controllers };
}

describe("K8sExecutor Job/Pod watch completion", () => {
  it.each(["configmap", "job"])(
    "preserves direct %s quota rejections as capacity pressure",
    async (resource) => {
      const fake = clients({ readJob: () => ({ status: {} }), watch: () => undefined });
      const rejection = Object.assign(new Error("Kubernetes API 403"), {
        code: 403,
        body: { message: QUOTA_MESSAGE },
      });
      if (resource === "configmap")
        fake.handles.coreApi.createNamespacedConfigMap.mockRejectedValue(rejection);
      else fake.handles.batchApi.createNamespacedJob.mockRejectedValue(rejection);
      await expect(
        new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
          runId: "quota-create",
          signal: new AbortController().signal,
        }),
      ).rejects.toBeInstanceOf(SandboxBackpressureError);
    },
  );

  it("waits through the production quota rejection and completes when capacity returns", async () => {
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "1" }, status: {} }),
      watch: (path, callback) => {
        if (path.includes("/jobs"))
          queueMicrotask(() => callback("MODIFIED", { status: { succeeded: 1 } }));
      },
    });
    fake.handles.coreApi.listNamespacedPod.mockResolvedValueOnce({ items: [] });
    fake.handles.coreApi.listNamespacedEvent = vi.fn(async () => ({
      items: [{ type: "Warning", reason: "FailedCreate", message: QUOTA_MESSAGE }],
    }));
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
      runId: "quota-recover",
      signal: new AbortController().signal,
    });
    expect(result.testcaseResults[0]?.verdict).toBe("AC");
    expect(fake.handles.batchApi.createNamespacedJob).toHaveBeenCalledOnce();
    expect(fake.handles.batchApi.deleteNamespacedJob).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "returns persistent quota pressure, but bounds failed cleanup (cleanup fails: %s)",
    async (cleanupFails) => {
      vi.useFakeTimers();
      const fake = clients({
        readJob: () => ({ metadata: { resourceVersion: "1" }, status: {} }),
        watch: () => undefined,
      });
      fake.handles.coreApi.listNamespacedPod.mockResolvedValue({ items: [] });
      fake.handles.coreApi.listNamespacedEvent = vi.fn(async () => ({
        items: [{ type: "Warning", reason: "FailedCreate", message: QUOTA_MESSAGE }],
      }));
      if (cleanupFails)
        fake.handles.batchApi.deleteNamespacedJob.mockRejectedValue(
          Object.assign(new Error("delete denied"), { code: 403 }),
        );
      const operation = new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
        runId: "quota-wait",
        signal: new AbortController().signal,
      });
      const outcome = operation.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await outcome).toBeInstanceOf(
        cleanupFails ? SandboxInfrastructureError : SandboxBackpressureError,
      );
      expect(fake.handles.coreApi.readNamespacedPodLog).not.toHaveBeenCalled();
      expect(fake.handles.batchApi.deleteNamespacedJob).toHaveBeenCalledOnce();
      expect(fake.handles.coreApi.deleteNamespacedConfigMap).toHaveBeenCalled();
    },
  );

  it("treats a Job deadline before any Pod exists as capacity pressure", async () => {
    const fake = clients({
      readJob: () => ({
        status: {
          failed: 1,
          conditions: [{ type: "Failed", status: "True", reason: "DeadlineExceeded" }],
        },
      }),
      watch: () => undefined,
    });
    fake.handles.coreApi.listNamespacedPod.mockResolvedValue({ items: [] });
    await expect(
      new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
        runId: "quota-deadline",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(SandboxBackpressureError);
    expect(fake.handles.coreApi.readNamespacedPodLog).not.toHaveBeenCalled();
  });

  it("returns from a Job watch event without a one-second polling delay", async () => {
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "job-rv-1" }, status: {} }),
      watch: (path, callback) => {
        if (path.includes("/jobs")) {
          queueMicrotask(() =>
            callback("MODIFIED", {
              metadata: { resourceVersion: "job-rv-2" },
              status: { succeeded: 1 },
            }),
          );
        }
      },
    });

    const startedAt = Date.now();
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
      runId: "watch-test",
      signal: new AbortController().signal,
    });

    expect(result.testcaseResults[0]?.verdict).toBe("AC");
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(fake.handles.watch.watch).toHaveBeenCalledWith(
      expect.stringContaining("/apis/batch/v1/namespaces/nojv-sandbox/jobs"),
      expect.objectContaining({
        fieldSelector: "metadata.name=judge-watch-test",
        resourceVersion: "job-rv-1",
      }),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("resynchronizes after HTTP 410 and then observes the completed Job", async () => {
    let reads = 0;
    let watchStarts = 0;
    const fake = clients({
      readJob: () => {
        reads += 1;
        return {
          metadata: { resourceVersion: `job-rv-${String(reads)}` },
          status: reads === 1 ? {} : { succeeded: 1 },
        };
      },
      watch: (_path, _callback, done) => {
        watchStarts += 1;
        if (watchStarts === 1) queueMicrotask(() => done({ statusCode: 410 }));
      },
    });

    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
      runId: "watch-test",
      signal: new AbortController().signal,
    });

    expect(result.testcaseResults[0]?.verdict).toBe("AC");
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(watchStarts).toBeGreaterThanOrEqual(2);
  });

  it("accepts Pod Succeeded before the Job controller updates the Job", async () => {
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "job-rv-1" }, status: {} }),
      watch: (path, callback) => {
        if (path.includes("/pods")) {
          queueMicrotask(() =>
            callback("MODIFIED", {
              metadata: { name: "watch-test-pod", resourceVersion: "pod-rv-2" },
              status: { phase: "Succeeded" },
            }),
          );
        }
      },
    });

    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
      runId: "watch-test",
      signal: new AbortController().signal,
    });

    expect(result.testcaseResults[0]?.verdict).toBe("AC");
  });

  it("closes active watches when the activity is cancelled", async () => {
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "job-rv-1" }, status: {} }),
      watch: () => undefined,
    });
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    const operation = new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
      runId: "watch-test",
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(fake.controllers).toHaveLength(2));
    controller.abort(reason);

    await expect(operation).rejects.toBe(reason);
    expect(fake.controllers.every((watchController) => watchController.signal.aborted)).toBe(
      true,
    );
  });

  it("does not start a watch when cancellation wins after the snapshot", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    let abortOnStatusRead = true;
    const fake = clients({
      readJob: () => ({
        metadata: { resourceVersion: "job-rv-1" },
        get status() {
          if (abortOnStatusRead) {
            abortOnStatusRead = false;
            controller.abort(reason);
          }
          return {};
        },
      }),
      watch: () => undefined,
    });

    await expect(
      new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
        runId: "watch-test",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(fake.handles.watch.watch).not.toHaveBeenCalled();
  });

  it("backs off repeated watch reconnects", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    const jobWatchStarts: number[] = [];
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "job-rv-1" }, status: {} }),
      watch: (path, _callback, done) => {
        if (path.includes("/jobs")) {
          jobWatchStarts.push(Date.now());
          const attempt = jobWatchStarts.length;
          queueMicrotask(() => {
            if (attempt === 3) controller.abort(reason);
            else done(null);
          });
          return;
        }
        queueMicrotask(() => done(null));
      },
    });

    await expect(
      new K8sExecutor(EXEC_CONFIG, fake.handles).execute(request(), {
        runId: "watch-test",
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(jobWatchStarts).toHaveLength(3);
    expect(jobWatchStarts[1]! - jobWatchStarts[0]!).toBeGreaterThanOrEqual(80);
    expect(jobWatchStarts[2]! - jobWatchStarts[1]!).toBeGreaterThanOrEqual(160);
  });
});

it.each([false, true])(
  "checker execution-only cases do not poison validator outcomes (mixed answers: %s)",
  async (hasAnswer) => {
    const fake = clients({
      readJob: () => ({ metadata: { resourceVersion: "done" }, status: { succeeded: 1 } }),
      watch: () => undefined,
    });
    fake.handles.coreApi.readNamespacedPodLog.mockImplementation(
      async ({ container }: { container: string }) => {
        if (container === "prepare")
          return JSON.stringify({ runCommand: ["python3", "main.py"] });
        if (container === "runner")
          return JSON.stringify({ validatorOutcomes: [{ index: 1, verdict: "WA" }] });
        return JSON.stringify({
          rawRuns: [
            {
              index: Number(container.slice(5)),
              stdout: "wrong",
              stderr: "",
              exitCode: 0,
              timeMs: 1,
            },
          ],
        });
      },
    );
    const result = await new K8sExecutor(EXEC_CONFIG, fake.handles).execute(
      {
        ...request(),
        judgeType: "checker",
        judgeConfig: { checkerLanguage: "python", checkerScript: "accept()" },
        testcases: [
          { index: 0, input: "", weight: 0, isSample: true },
          {
            index: 1,
            input: "",
            weight: 0,
            isSample: true,
            ...(hasAnswer ? { output: "" } : {}),
          },
        ],
      },
      { runId: "checker-custom", signal: new AbortController().signal },
    );
    expect(result.testcaseResults.map((run) => run.verdict)).toEqual([
      "AC",
      hasAnswer ? "WA" : "AC",
    ]);
    expect(fake.handles.batchApi.createNamespacedJob).toHaveBeenCalledTimes(hasAnswer ? 2 : 1);
  },
);
