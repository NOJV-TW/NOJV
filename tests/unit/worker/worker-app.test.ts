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
  healthCheckLiveness: null as null | (() => boolean),
  startJudgeRecoveryMetrics: vi.fn(),
  stopJudgeRecoveryMetrics: vi.fn(),
  healthClose: vi.fn(),
  healthListen: vi.fn(),
  workerCreate: vi.fn(),
  setExecutorOwner: vi.fn(),
  dockerSweeperDone: Promise.resolve(),
  dockerSweeperShutdown: vi.fn(),
  dockerSweeperStart: vi.fn(),
  verifySandboxRuntime: vi.fn(),
  verifyNetworkPolicyEnforced: vi.fn(),
  validateMailerConfig: vi.fn(),
  startNodeLoadSlots: vi.fn(),
  stopNodeLoadSlots: vi.fn(),
  createEnginePool: vi.fn(),
  enginePoolDispose: vi.fn(),
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
  JUDGE_STATE_TASK_QUEUE: "judge-state",
  JUDGE_CLEANUP_TASK_QUEUE: "judge-cleanup",
  PLATFORM_TASK_QUEUE: "platform",
  TEST_JUDGE_TASK_QUEUE: "test-judge",
  temporalConnectionOptions: () => ({}),
}));

vi.mock("@nojv/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/storage")>()),
  createStorageClient: () => ({}),
}));

vi.mock("@nojv/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nojv/mailer")>()),
  validateMailerConfig: mocks.validateMailerConfig,
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
  createWorkerHealthServer: (deps: {
    checkTemporal: () => Promise<boolean>;
    checkLiveness: () => boolean;
  }) => {
    mocks.healthCheckLiveness = deps.checkLiveness;
    mocks.healthCheckTemporal = deps.checkTemporal;
    return {
      close: mocks.healthClose,
      listen: mocks.healthListen,
      listening: true,
    };
  },
}));

vi.mock("../../../apps/worker/src/judge-recovery-metrics", () => ({
  startJudgeRecoveryMetrics: mocks.startJudgeRecoveryMetrics,
}));

vi.mock("../../../apps/worker/src/judge-slot-supplier", () => ({
  startNodeLoadSlots: mocks.startNodeLoadSlots,
}));

vi.mock("../../../apps/worker/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../apps/worker/src/sandbox/shared/executor-factory", () => ({
  createExecutorOwner: () => ({
    abortActive: mocks.executorAbortActive,
    shutdown: mocks.executorShutdown,
  }),
}));

vi.mock("../../../apps/worker/src/test-judge/runtime.js", () => ({
  createEnginePool: mocks.createEnginePool,
}));

vi.mock("../../../apps/worker/src/activities/judge.js", () => ({
  setExecutorOwner: mocks.setExecutorOwner,
}));

vi.mock("../../../apps/worker/src/sandbox/docker/resource-sweeper.js", () => ({
  createDockerResourceSweeper: () => ({
    done: mocks.dockerSweeperDone,
    shutdown: mocks.dockerSweeperShutdown,
    start: mocks.dockerSweeperStart,
  }),
}));

vi.mock("../../../apps/worker/src/sandbox/kubernetes/runtime-probe.js", () => ({
  verifySandboxRuntime: mocks.verifySandboxRuntime,
}));

vi.mock("../../../apps/worker/src/sandbox/kubernetes/netpol-probe.js", () => ({
  verifyNetworkPolicyEnforced: mocks.verifyNetworkPolicyEnforced,
}));

import { WorkerApp } from "../../../apps/worker/src/worker-app";
import { validateWorkerMailerStartup } from "../../../apps/worker/src/mailer-startup";

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
  SANDBOX_MAX_MEMORY_MB: 1536,
  WASM_OJ_RUNTIME_DIR: "",
  WASM_OJ_TOOLCHAIN_DIR: "",
  WASM_OJ_CACHE_DIR: "/tmp/wasm-oj",
  TEST_JUDGE_SLOTS: 2,
};

const testJudgeRuntime = {
  WASM_OJ_RUNTIME_DIR: "/opt/wasm-oj/runtime",
  WASM_OJ_TOOLCHAIN_DIR: "/opt/wasm-oj/toolchains",
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
  mocks.healthCheckLiveness = null;
  mocks.startJudgeRecoveryMetrics.mockReturnValue(mocks.stopJudgeRecoveryMetrics);
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
  mocks.verifySandboxRuntime.mockResolvedValue({ ok: true });
  mocks.validateMailerConfig.mockReset();
  mocks.verifyNetworkPolicyEnforced.mockResolvedValue({ enforced: false, action: "refuse" });
  mocks.healthListen.mockImplementation((_port: number, callback: () => void) => callback());
  mocks.healthClose.mockImplementation((callback: (error?: Error) => void) => callback());
  mocks.createEnginePool.mockResolvedValue({
    acquire: vi.fn(),
    dispose: mocks.enginePoolDispose,
  });
});

describe("WorkerApp lifecycle", () => {
  const kubernetesEnv: WorkerEnv = {
    ...env,
    EXECUTION_BACKEND: "kubernetes",
    WORKER_MODE: "judge",
    K8S_NAMESPACE: "nojv-sandbox",
    K8S_CPU_REQUEST: "1",
    K8S_CPU_LIMIT: "1",
    K8S_MEMORY_REQUEST: "512Mi",
    K8S_MEMORY_LIMIT: "512Mi",
    K8S_RUN_PARALLELISM: 1,
    K8S_RUNTIME_CLASS_NAME: "gvisor",
  };

  it.each([
    {
      name: "legacy judge",
      workerEnv: { ...env, WORKER_MODE: "judge" } as WorkerEnv,
      queues: ["judge", "judge-state", "judge-cleanup"],
    },
    {
      name: "kubernetes judge",
      workerEnv: kubernetesEnv,
      queues: ["judge", "judge-state", "judge-cleanup"],
    },
    { name: "platform", workerEnv: env, queues: ["platform"] },
    {
      name: "combined",
      workerEnv: { ...kubernetesEnv, WORKER_MODE: "all" } as WorkerEnv,
      queues: ["judge", "judge-state", "judge-cleanup", "platform"],
    },
    {
      name: "test",
      workerEnv: { ...env, ...testJudgeRuntime, WORKER_MODE: "test" } as WorkerEnv,
      queues: ["test-judge"],
    },
    {
      name: "combined with the WASM-OJ runtime",
      workerEnv: { ...kubernetesEnv, ...testJudgeRuntime, WORKER_MODE: "all" } as WorkerEnv,
      queues: ["judge", "judge-state", "judge-cleanup", "platform", "test-judge"],
    },
  ])(
    "bounds cached workflows and workflow task slots for $name workers",
    async ({ workerEnv, queues }) => {
      const workers: ReturnType<typeof makeWorker>[] = [];
      mocks.workerCreate.mockImplementation(async () => {
        const worker = makeWorker();
        workers.push(worker);
        return worker;
      });
      mocks.verifyNetworkPolicyEnforced.mockResolvedValue({ enforced: true, action: "ok" });
      const app = new WorkerApp(
        { ...workerEnv, WORKER_CONCURRENCY: 3 },
        { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
      );
      const started = app.start();
      try {
        await vi.waitFor(() => {
          expect(workers).toHaveLength(queues.length);
          for (const worker of workers) expect(worker.run).toHaveBeenCalledOnce();
        });
        expect(mocks.workerCreate).toHaveBeenCalledTimes(queues.length);
        for (const taskQueue of queues) {
          if (taskQueue === "test-judge") continue;
          expect(mocks.workerCreate).toHaveBeenCalledWith(
            taskQueue === "judge-state" || taskQueue === "judge-cleanup"
              ? expect.not.objectContaining({ workflowsPath: expect.anything() })
              : expect.objectContaining({
                  taskQueue,
                  maxCachedWorkflows: 32,
                  maxConcurrentWorkflowTaskExecutions: 8,
                  maxConcurrentActivityTaskExecutions: 3,
                }),
          );
        }
        if (queues.includes("test-judge"))
          expect(mocks.workerCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              taskQueue: "test-judge",
              workflowsPath: "workflow.js",
              maxCachedWorkflows: 16,
              maxConcurrentActivityTaskExecutions: 2,
            }),
          );
        for (const activityQueue of ["judge-state", "judge-cleanup"])
          if (queues.includes(activityQueue))
            expect(mocks.workerCreate).toHaveBeenCalledWith(
              expect.objectContaining({
                taskQueue: activityQueue,
                maxConcurrentActivityTaskExecutions: 16,
              }),
            );
      } finally {
        await app.shutdown("SIGTERM");
        await started;
      }
    },
  );

  it.each([
    { WASM_OJ_RUNTIME_DIR: "", WASM_OJ_TOOLCHAIN_DIR: "/opt/wasm-oj/toolchains" },
    { WASM_OJ_RUNTIME_DIR: "/opt/wasm-oj/runtime", WASM_OJ_TOOLCHAIN_DIR: "" },
  ])("refuses test mode without both WASM-OJ directories (%o)", async (dirs) => {
    const app = new WorkerApp(
      { ...env, ...dirs, WORKER_MODE: "test" },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );

    await expect(app.start()).rejects.toThrow(/WASM_OJ_RUNTIME_DIR and WASM_OJ_TOOLCHAIN_DIR/);
    expect(mocks.createEnginePool).not.toHaveBeenCalled();
    expect(mocks.workerCreate).not.toHaveBeenCalled();
    await expect(app.shutdown("startup failure")).resolves.toMatchObject({ complete: true });
  });

  it("serves only test-judge activities in test mode and disposes the engines after draining", async () => {
    const events: string[] = [];
    const worker = makeWorker(events);
    mocks.workerCreate.mockResolvedValue(worker);
    mocks.enginePoolDispose.mockImplementation(() => events.push("engines"));
    const app = new WorkerApp(
      { ...env, ...testJudgeRuntime, WORKER_MODE: "test", TEST_JUDGE_SLOTS: 3 },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );
    const started = app.start();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());

    expect(mocks.createEnginePool).toHaveBeenCalledWith({
      runtimeDir: "/opt/wasm-oj/runtime",
      toolchainDir: "/opt/wasm-oj/toolchains",
      cacheDir: "/tmp/wasm-oj",
      slots: 3,
    });
    const options = mocks.workerCreate.mock.calls[0]?.[0] as { activities: object };
    expect(Object.keys(options.activities).sort()).toEqual([
      "buildTestJudgeProgram",
      "runTestJudge",
    ]);
    expect(mocks.startJudgeRecoveryMetrics).not.toHaveBeenCalled();
    expect(mocks.setExecutorOwner).not.toHaveBeenCalled();
    expect(mocks.ensureSubmissionSweeper).not.toHaveBeenCalled();

    await app.shutdown("SIGTERM");
    await started;
    expect(events).toEqual(["worker", "engines"]);
  });

  it("tunes judge activity slots to node load when a minimum concurrency is set", async () => {
    const supplier = { type: "custom" };
    mocks.startNodeLoadSlots.mockReturnValue({ supplier, stop: mocks.stopNodeLoadSlots });
    mocks.workerCreate.mockImplementation(async () => makeWorker());
    mocks.verifyNetworkPolicyEnforced.mockResolvedValue({ enforced: true, action: "ok" });
    const app = new WorkerApp(
      { ...kubernetesEnv, WORKER_CONCURRENCY: 6, WORKER_MIN_CONCURRENCY: 2 },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );
    const started = app.start();
    try {
      await vi.waitFor(() => expect(mocks.workerCreate).toHaveBeenCalledTimes(3));
      expect(mocks.startNodeLoadSlots).toHaveBeenCalledWith(2, 6);
      const options = mocks.workerCreate.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .find((value) => value.taskQueue === "judge")!;
      expect(options).not.toHaveProperty("maxConcurrentActivityTaskExecutions");
      expect(options).not.toHaveProperty("maxConcurrentWorkflowTaskExecutions");
      expect(options).toMatchObject({
        taskQueue: "judge",
        maxCachedWorkflows: 32,
        tuner: {
          workflowTaskSlotSupplier: { type: "fixed-size", numSlots: 8 },
          activityTaskSlotSupplier: supplier,
        },
      });
    } finally {
      await app.shutdown("SIGTERM");
      await started;
    }
    expect(mocks.stopNodeLoadSlots).toHaveBeenCalledOnce();
  });

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

  it("ignores the NetworkPolicy opt-out in production", async () => {
    const productionKubernetesEnv: WorkerEnv = {
      NODE_ENV: "production",
      PORT: 3002,
      REDIS_URL: "redis://localhost:6379",
      TEMPORAL_ADDRESS: "localhost:7233",
      TEMPORAL_NAMESPACE: "default",
      SANDBOX_IMAGE: "sandbox:test",
      WORKER_CONCURRENCY: 1,
      WORKER_MODE: "judge",
      EXECUTION_BACKEND: "kubernetes",
      K8S_NAMESPACE: "nojv-sandbox",
      K8S_CPU_REQUEST: "500m",
      K8S_CPU_LIMIT: "1",
      K8S_MEMORY_REQUEST: "256Mi",
      K8S_MEMORY_LIMIT: "256Mi",
      K8S_RUN_PARALLELISM: 1,
      K8S_RUNTIME_CLASS_NAME: "gvisor",
      SANDBOX_MEMORY_HEADROOM_MB: 64,
      SANDBOX_MAX_MEMORY_MB: 2048,
      WASM_OJ_RUNTIME_DIR: "",
      WASM_OJ_TOOLCHAIN_DIR: "",
      WASM_OJ_CACHE_DIR: "/tmp/wasm-oj",
      TEST_JUDGE_SLOTS: 2,
    };
    const app = new WorkerApp(productionKubernetesEnv, {
      shutdownTimeoutMs: 100,
      workflowsPath: "workflow.js",
    });

    await expect(app.start()).rejects.toThrow(/NetworkPolicy/);
    expect(mocks.verifyNetworkPolicyEnforced).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: "nojv-sandbox", runtimeClassName: "gvisor" }),
    );
    expect(mocks.workerCreate).not.toHaveBeenCalled();
    await expect(app.shutdown("startup failure")).resolves.toMatchObject({ complete: true });
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
    expect(mocks.sweepStaleSubmissions.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recoverSystemErrorSubmissions.mock.invocationCallOrder[0],
    );

    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(true);
    const first = app.shutdown("SIGTERM");
    const second = app.shutdown("SIGINT");
    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(false);

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await started;
    expect(worker.shutdown).toHaveBeenCalledOnce();
  });

  it("keeps liveness independent of dependency connectivity and disables restart during graceful drain", async () => {
    const worker = makeWorker();
    mocks.workerCreate.mockResolvedValue(worker);
    const app = new WorkerApp(env, { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" });
    const started = app.start();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    mocks.connectionEnsureConnected.mockRejectedValue(new Error("Temporal offline"));
    expect(mocks.healthCheckLiveness?.()).toBe(true);
    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(false);
    worker.getState.mockReturnValue("FAILED");
    expect(mocks.healthCheckLiveness?.()).toBe(false);
    const stopped = app.shutdown("SIGTERM");
    expect(mocks.healthCheckLiveness?.()).toBe(true);
    await stopped;
    await started;
    expect(mocks.stopJudgeRecoveryMetrics).toHaveBeenCalledOnce();
  });

  it("fails startup lifetime when a worker run loop ends without shutdown", async () => {
    const worker = makeWorker();
    worker.run.mockResolvedValue(undefined);
    mocks.workerCreate.mockResolvedValue(worker);
    const app = new WorkerApp(env, { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" });
    await expect(app.start()).rejects.toThrow("run loop stopped unexpectedly");
    expect(mocks.healthCheckLiveness?.()).toBe(false);
    await app.shutdown("fatal");
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
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledTimes(3));
    expect(mocks.recoverSystemErrorSubmissions).not.toHaveBeenCalled();

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
