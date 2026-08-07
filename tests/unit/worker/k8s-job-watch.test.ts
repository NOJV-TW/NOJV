import { describe, expect, it, vi } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { K8sExecutor } from "../../../apps/worker/src/services/k8s-executor";

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
