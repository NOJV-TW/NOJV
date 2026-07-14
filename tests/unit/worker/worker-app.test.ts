import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerEnv } from "../../../apps/worker/src/env";

const mocks = vi.hoisted(() => ({
  closeTemporalClient: vi.fn(),
  connectionClose: vi.fn(),
  connectionEnsureConnected: vi.fn(),
  ensureLifecycleReconciler: vi.fn(),
  ensureSubmissionSweeper: vi.fn(),
  healthCheckTemporal: null as null | (() => Promise<boolean>),
  healthClose: vi.fn(),
  healthListen: vi.fn(),
  workerCreate: vi.fn(),
}));

vi.mock("@nojv/temporal", () => ({
  buildDomainOrchestrationAdapter: () => ({}),
  closeTemporalClient: mocks.closeTemporalClient,
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
  mocks.ensureSubmissionSweeper.mockResolvedValue(undefined);
  mocks.ensureLifecycleReconciler.mockResolvedValue(undefined);
  mocks.healthListen.mockImplementation((_port: number, callback: () => void) => callback());
  mocks.healthClose.mockImplementation((callback: (error?: Error) => void) => callback());
});

describe("WorkerApp lifecycle", () => {
  it("cleans partially acquired startup resources in reverse order", async () => {
    const events: string[] = [];
    const worker = makeWorker(events);
    mocks.workerCreate.mockResolvedValue(worker);
    mocks.ensureSubmissionSweeper.mockRejectedValue(new Error("schedule unavailable"));
    mocks.closeTemporalClient.mockImplementation(async () => {
      events.push("temporal client");
    });
    mocks.connectionClose.mockImplementation(async () => {
      events.push("native connection");
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
});
