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
  verifySandboxRuntime: vi.fn(),
  verifyNetworkPolicyEnforced: vi.fn(),
  getTemporalClient: vi.fn(),
  coordinatorStart: vi.fn(),
  validateMailerConfig: vi.fn(),
  refreshJudgeCapacity: vi.fn(),
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
  getTemporalClient: mocks.getTemporalClient,
  ensureDurableWorkProcessor: mocks.ensureDurableWorkProcessor,
  ensureLifecycleReconciler: mocks.ensureLifecycleReconciler,
  ensureSubmissionSweeper: mocks.ensureSubmissionSweeper,
  JUDGE_TASK_QUEUE: "judge",
  PLATFORM_TASK_QUEUE: "platform",
  temporalConnectionOptions: () => ({}),
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

vi.mock("../../../apps/worker/src/activities/judge-control-bundle.js", () => ({
  refreshJudgeCapacity: mocks.refreshJudgeCapacity,
}));

vi.mock("../../../apps/worker/src/services/docker-resource-sweeper.js", () => ({
  createDockerResourceSweeper: () => ({
    done: mocks.dockerSweeperDone,
    shutdown: mocks.dockerSweeperShutdown,
    start: mocks.dockerSweeperStart,
  }),
}));

vi.mock("../../../apps/worker/src/services/k8s-runtime-probe.js", () => ({
  verifySandboxRuntime: mocks.verifySandboxRuntime,
}));

vi.mock("../../../apps/worker/src/services/k8s-netpol-probe.js", () => ({
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
  mocks.verifySandboxRuntime.mockResolvedValue({ ok: true });
  mocks.getTemporalClient.mockResolvedValue({ workflow: { start: mocks.coordinatorStart } });
  mocks.coordinatorStart.mockResolvedValue(undefined);
  mocks.validateMailerConfig.mockReset();
  mocks.verifyNetworkPolicyEnforced.mockResolvedValue({ enforced: false, action: "refuse" });
  mocks.healthListen.mockImplementation((_port: number, callback: () => void) => callback());
  mocks.healthClose.mockImplementation((callback: (error?: Error) => void) => callback());
});

describe("WorkerApp lifecycle", () => {
  const controlEnv: WorkerEnv = {
    ...env,
    EXECUTION_BACKEND: "kubernetes",
    WORKER_MODE: "control",
    K8S_NAMESPACE: "nojv-sandbox",
    K8S_CAPACITY_ADMISSION: true,
    K8S_ARTIFACT_STORAGE_CLASS: "local-path",
    K8S_CPU_REQUEST: "1",
    K8S_CASE_CPU_REQUEST: "1",
    K8S_CPU_LIMIT: "1",
    K8S_MEMORY_REQUEST: "512Mi",
    K8S_MEMORY_LIMIT: "512Mi",
    K8S_MAX_PARALLEL_CASES: 4,
    K8S_RUNTIME_CLASS_NAME: "gvisor",
  };

  it("starts an independent control worker despite unavailable sandbox probes and mailer configuration", async () => {
    const worker = makeWorker();
    mocks.workerCreate.mockResolvedValue(worker);
    mocks.verifySandboxRuntime.mockRejectedValue(new Error("Sandbox quota exhausted"));
    mocks.verifyNetworkPolicyEnforced.mockRejectedValue(new Error("Sandbox nodes unavailable"));
    mocks.validateMailerConfig.mockImplementation(() => {
      throw new Error("Mailer is unconfigured");
    });
    const app = new WorkerApp(controlEnv, {
      shutdownTimeoutMs: 100,
      workflowsPath: "workflow.js",
    });
    validateWorkerMailerStartup(controlEnv.WORKER_MODE);
    const started = app.start();
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    expect(mocks.workerCreate).toHaveBeenCalledOnce();
    expect(mocks.workerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: "judge-control",
        activities: expect.objectContaining({
          refreshJudgeCapacity: mocks.refreshJudgeCapacity,
        }),
      }),
    );
    expect(mocks.coordinatorStart).toHaveBeenCalledWith(
      "judgeAdmissionWorkflow",
      expect.objectContaining({ workflowId: "judge-admission-v1", taskQueue: "judge-control" }),
    );
    expect(mocks.verifySandboxRuntime).not.toHaveBeenCalled();
    expect(mocks.verifyNetworkPolicyEnforced).not.toHaveBeenCalled();
    expect(mocks.validateMailerConfig).not.toHaveBeenCalled();
    expect(mocks.setExecutorOwner).not.toHaveBeenCalled();
    expect(mocks.ensureSubmissionSweeper).not.toHaveBeenCalled();
    await expect(mocks.healthCheckTemporal?.()).resolves.toBe(true);
    await app.shutdown("SIGTERM");
    await started;
    expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
  });

  it("closes the acquired Temporal client when coordinator startup fails", async () => {
    mocks.workerCreate.mockResolvedValue(makeWorker());
    mocks.coordinatorStart.mockRejectedValue(new Error("Temporal coordinator unavailable"));
    const app = new WorkerApp(controlEnv, {
      shutdownTimeoutMs: 100,
      workflowsPath: "workflow.js",
    });
    await expect(app.start()).rejects.toThrow("Temporal coordinator unavailable");
    await app.shutdown("startup failure");
    expect(mocks.closeTemporalClient).toHaveBeenCalledOnce();
    expect(mocks.connectionClose).toHaveBeenCalledOnce();
  });

  it("rejects control mode when capacity admission is disabled instead of polling no queues", async () => {
    const app = new WorkerApp(
      { ...controlEnv, K8S_CAPACITY_ADMISSION: false },
      { shutdownTimeoutMs: 100, workflowsPath: "workflow.js" },
    );
    await expect(app.start()).rejects.toThrow("requires Kubernetes capacity admission");
    expect(mocks.workerCreate).not.toHaveBeenCalled();
    await app.shutdown("startup failure");
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
      K8S_CASE_CPU_REQUEST: "100m",
      K8S_CPU_LIMIT: "1",
      K8S_MEMORY_REQUEST: "256Mi",
      K8S_MEMORY_LIMIT: "256Mi",
      K8S_MAX_PARALLEL_CASES: 20,
      K8S_CAPACITY_ADMISSION: false,
      K8S_ARTIFACT_STORAGE_CLASS: "local-path",
      K8S_RUNTIME_CLASS_NAME: "gvisor",
      SANDBOX_MEMORY_HEADROOM_MB: 64,
      SANDBOX_MAX_MEMORY_MB: 2048,
      REGISTRY_GC_IMAGE: "registry:2.8.3",
      REGISTRY_GC_NAMESPACE: "nojv",
      REGISTRY_GC_CONFIG_CONFIGMAP: "registry-config",
      REGISTRY_GC_S3_SECRET: "registry-secret",
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
