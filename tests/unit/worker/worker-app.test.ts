import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerEnv } from "../../../apps/worker/src/env";

const mocks = vi.hoisted(() => ({
  closeTemporalClient: vi.fn(),
  connectionClose: vi.fn(),
  connectionEnsureConnected: vi.fn(),
  ensureDurableWorkProcessor: vi.fn(),
  ensureLifecycleReconciler: vi.fn(),
  ensureSubmissionSweeper: vi.fn(),
  recoverSystemErrorSubmissions: vi.fn(),
  sweepStaleSubmissions: vi.fn(),
  executorAbortActive: vi.fn(),
  executorShutdown: vi.fn(),
  healthCheckTemporal: null as null | (() => Promise<boolean>),
  healthClose: vi.fn(),
  healthListen: vi.fn(),
  workerCreate: vi.fn(),
  setExecutorOwner: vi.fn(),
  dockerSweeperDone: Promise.resolve(),
  dockerSweeperShutdown: vi.fn(),
  dockerSweeperStart: vi.fn(),
}));

vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...actual,
    submissionDomain: {
      ...actual.submissionDomain,
      recoverSystemErrorSubmissions: mocks.recoverSystemErrorSubmissions,
      sweepStaleSubmissions: mocks.sweepStaleSubmissions,
    },
  };
});

vi.mock("@nojv/temporal", () => ({
  buildDomainOrchestrationAdapter: () => ({}),
  closeTemporalClient: mocks.closeTemporalClient,
  ensureDurableWorkProcessor: mocks.ensureDurableWorkProcessor,
  ensureLifecycleReconciler: mocks.ensureLifecycleReconciler,
  ensureSubmissionSweeper: mocks.ensureSubmissionSweeper,
  JUDGE_TASK_QUEUE: "judge",
  PLATFORM_TASK_QUEUE: "platform",
  temporalConnectionOptions: () => ({}),
}));

vi.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect: () =>
      Promise.resolve({
        close: mocks.connectionClose,
        ensureConnected: mocks.connectionEnsureConnected,
      }),
  },
  Worker: { create: mocks.workerCreate },
}));

vi.mock("../../../apps/worker/src/health-server", () => ({
  createWorkerHealthServer: (deps: { checkTemporal: () => Promise<boolean> }) => {
    mocks.healthCheckTemporal = deps.checkTemporal;
    return {
      close: mocks.healthClose,
      listen: mocks.healthListen,
      listening: true,
    };
  },
}));

vi.mock("../../../apps/worker/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../apps/worker/src/services/executor-factory", () => ({
  createExecutorOwner: () => ({
    abortActive: mocks.executorAbortActive,
    shutdown: mocks.executorShutdown,
  }),
}));

vi.mock("../../../apps/worker/src/activities/judge.js", () => ({
  setExecutorOwner: mocks.setExecutorOwner,
}));

vi.mock("../../../apps/worker/src/services/docker-resource-sweeper.js", () => ({
  createDockerResourceSweeper: () => ({
    done: mocks.dockerSweeperDone,
    shutdown: mocks.dockerSweeperShutdown,
    start: mocks.dockerSweeperStart,
  }),
}));

import { WorkerApp } from "../../../apps/worker/src/worker-app";

const env: WorkerEnv = {
  NODE_ENV: "test",
  PORT: 3002,
  REDIS_URL: "redis://localhost:6379",
  TEMPORAL_ADDRESS: "localhost:7233",
  TEMPORAL_NAMESPACE: "default",
  SANDBOX_IMAGE: "sandbox:test",
  WORKER_CONCURRENCY: 1,
  WORKER_MODE: "platform",
  EXECUTION_BACKEND: "docker",
  SANDBOX_CPU_LIMIT: "1",
  SANDBOX_MEMORY_MB: 256,
  SANDBOX_PIDS_LIMIT: 64,
  SANDBOX_MEMORY_HEADROOM_MB: 64,
  SANDBOX_MAX_MEMORY_MB: 2048,
  REGISTRY_GC_IMAGE: "registry:2.8.3",
  REGISTRY_GC_NAMESPACE: "nojv",
  REGISTRY_GC_CONFIG_CONFIGMAP: "registry-config",
  REGISTRY_GC_S3_SECRET: "registry-secret",
};

function makeWorker(events: string[] = []) {
  let stop!: () => void;
  const running = new Promise<void>((resolve) => {
    stop = resolve;
  });
  return {
    getState: vi.fn(() => "RUNNING"),
    run: vi.fn(() => running),
    shutdown: vi.fn(() => {
      events.push("worker");
      stop();
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.healthCheckTemporal = null;
  mocks.connectionEnsureConnected.mockResolvedValue(undefined);
  mocks.connectionClose.mockResolvedValue(undefined);
  mocks.closeTemporalClient.mockResolvedValue(undefined);
  mocks.ensureDurableWorkProcessor.mockResolvedValue(undefined);
  mocks.ensureSubmissionSweeper.mockResolvedValue(undefined);
  mocks.ensureLifecycleReconciler.mockResolvedValue(undefined);
  mocks.recoverSystemErrorSubmissions.mockResolvedValue(0);
  mocks.sweepStaleSubmissions.mockResolvedValue({});
  mocks.executorShutdown.mockResolvedValue(undefined);
  mocks.dockerSweeperShutdown.mockResolvedValue(undefined);
  mocks.dockerSweeperStart.mockResolvedValue(undefined);
  mocks.healthListen.mockImplementation((_port: number, callback: () => void) => callback());
  mocks.healthClose.mockImplementation((callback: (error?: Error) => void) => callback());
});

describe("WorkerApp lifecycle", () => {
  it("fails closed before creating a judge worker when Docker resource recovery fails", async () => {
    mocks.dockerSweeperStart.mockRejectedValue(new Error("Docker resource recovery failed"));
    const app = new WorkerApp(
      { ...env, WORKER_MODE: "judge" },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );

    await expect(app.start()).rejects.toThrow("Docker resource recovery failed");
    expect(mocks.dockerSweeperStart).toHaveBeenCalledOnce();
    expect(mocks.workerCreate).not.toHaveBeenCalled();

    await expect(app.shutdown("startup failure")).resolves.toMatchObject({ complete: true });
    expect(mocks.dockerSweeperShutdown).toHaveBeenCalledOnce();
  });

  it("cleans partially acquired startup resources in reverse order", async () => {
    const events: string[] = [];
    const worker = makeWorker(events);
    mocks.workerCreate.mockResolvedValue(worker);
    mocks.ensureSubmissionSweeper.mockRejectedValue(new Error("schedule unavailable"));
    mocks.closeTemporalClient.mockImplementation(() => {
      events.push("temporal client");
      return Promise.resolve();
    });
    mocks.connectionClose.mockImplementation(() => {
      events.push("native connection");
      return Promise.resolve();
    });

    const app = new WorkerApp(env, { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" });

    await expect(app.start()).rejects.toThrow("schedule unavailable");
    await app.shutdown("startup failure");
    expect(events).toEqual(["temporal client", "worker", "native connection"]);
  });

  it("becomes not-ready synchronously and coalesces repeated shutdown", async () => {
    const worker = makeWorker();
    mocks.workerCreate.mockResolvedValue(worker);
    const app = new WorkerApp(env, { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" });
    const started = app.start();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());

    expect(mocks.sweepStaleSubmissions).toHaveBeenCalledOnce();
    expect(mocks.recoverSystemErrorSubmissions).toHaveBeenCalledOnce();

    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(true);
    const first = app.shutdown("SIGTERM");
    const second = app.shutdown("SIGINT");
    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(false);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await started;
    expect(worker.shutdown).toHaveBeenCalledOnce();
  });

  it("bounds a hung cleanup but still attempts every later resource", async () => {
    vi.useFakeTimers();
    try {
      const worker = makeWorker();
      mocks.workerCreate.mockResolvedValue(worker);
      mocks.healthClose.mockImplementation(() => undefined);
      const app = new WorkerApp(env, { shutdownTimeoutMs: 10, workflowsPath: "workflow.js" });
      const started = app.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.run).toHaveBeenCalledOnce();

      const stopping = app.shutdown("SIGTERM");
      await vi.advanceTimersByTimeAsync(10);
      const report = await stopping;

      expect(report.complete).toBe(false);
      expect(report.issues).toContainEqual({ resource: "health server", reason: "timed out" });
      expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
      expect(worker.shutdown).toHaveBeenCalledOnce();
      expect(mocks.connectionClose).toHaveBeenCalledOnce();
      await started;
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts active sandbox executions synchronously and awaits their cleanup", async () => {
    let finishExecutionCleanup!: () => void;
    mocks.executorShutdown.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishExecutionCleanup = resolve;
        }),
    );
    const worker = makeWorker();
    mocks.workerCreate.mockResolvedValue(worker);
    const app = new WorkerApp(
      { ...env, WORKER_MODE: "judge" },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );
    const started = app.start();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    expect(mocks.recoverSystemErrorSubmissions).toHaveBeenCalledOnce();

    let finished = false;
    const stopping = app.shutdown("SIGTERM").then(() => {
      finished = true;
    });
    expect(mocks.executorAbortActive).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.executorShutdown).toHaveBeenCalledOnce());
    expect(finished).toBe(false);

    finishExecutionCleanup();
    await stopping;
    await started;
    expect(finished).toBe(true);
  });
});
