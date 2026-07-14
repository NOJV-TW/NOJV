import { createRequire } from "node:module";

import { NativeConnection, Worker } from "@temporalio/worker";
import "./domain-orchestration";

import {
  closeTemporalClient,
  ensureLifecycleReconciler,
  ensureSubmissionSweeper,
  JUDGE_TASK_QUEUE,
  PLATFORM_TASK_QUEUE,
  temporalConnectionOptions,
} from "@nojv/temporal";

const require = createRequire(import.meta.url);

import type { WorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { createLogger } from "./logger.js";
import {
  closeServerSafely,
  settleCleanupSteps,
  type CleanupReport,
  type CleanupStep,
} from "./server-lifecycle";
import { createExecutorOwner } from "./services/executor-factory";
import type { ExecutorOwner } from "./services/executor-owner";

const logger = createLogger("worker");
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 35_000;

interface ManagedWorker {
  worker: Worker;
  runPromise: Promise<void> | null;
}

export class WorkerApp {
  private readonly workers: ManagedWorker[] = [];
  private readonly cleanupSteps: CleanupStep[] = [];
  private readonly healthServer: ReturnType<typeof createWorkerHealthServer>;
  private readonly env: WorkerEnv;
  private readonly shutdownTimeoutMs: number;
  private readonly workflowsPath: string;
  private shutdownPromise: Promise<CleanupReport> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private runPromise: Promise<unknown> | null = null;
  private connection: NativeConnection | null = null;
  private executorOwner: ExecutorOwner | null = null;
  private stopping = false;

  constructor(
    env: WorkerEnv,
    options: { shutdownTimeoutMs?: number; workflowsPath?: string } = {},
  ) {
    this.env = env;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.workflowsPath = options.workflowsPath ?? require.resolve("./workflows/index.js");
    this.healthServer = createWorkerHealthServer({
      redisUrl: env.REDIS_URL,
      checkTemporal: async () => {
        if (this.stopping) return false;
        if (
          this.workers.length === 0 ||
          !this.workers.every(({ worker }) => worker.getState() === "RUNNING")
        ) {
          return false;
        }
        if (!this.connection) return false;
        try {
          await this.connection.ensureConnected();
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  async start(): Promise<void> {
    this.initializationPromise = this.initialize();
    await this.initializationPromise;
    if (this.stopping) throw new Error("Worker startup interrupted by shutdown.");

    const runPromises = this.workers.map((managed) => {
      const runPromise = managed.worker.run();
      managed.runPromise = runPromise;
      return runPromise;
    });
    this.runPromise = Promise.all(runPromises);
    await this.runPromise;
  }

  private async initialize(): Promise<void> {
    const address = this.env.TEMPORAL_ADDRESS;
    const namespace = this.env.TEMPORAL_NAMESPACE;
    const mode = this.env.WORKER_MODE;
    const { tls, apiKey } = temporalConnectionOptions();
    const connection = await NativeConnection.connect({
      address,
      ...(tls !== undefined ? { tls } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    this.connection = connection;
    this.cleanupSteps.push({
      resource: "native Temporal connection",
      run: () => connection.close(),
    });
    this.assertStarting();

    if (mode === "all" || mode === "judge") {
      const { setExecutorOwner } = await import("./activities/judge.js");
      const executorOwner = createExecutorOwner(this.env);
      this.executorOwner = executorOwner;
      setExecutorOwner(executorOwner);
      this.cleanupSteps.push({
        resource: "sandbox executions",
        run: () =>
          executorOwner.shutdown(new DOMException("Worker is shutting down.", "AbortError")),
      });

      if (this.env.EXECUTION_BACKEND === "docker") {
        const { sweepOrphanNetworks } = await import("./services/docker-network.js");
        sweepOrphanNetworks();
      }

      if (this.env.EXECUTION_BACKEND === "kubernetes") {
        const { verifyNetworkPolicyEnforced } = await import("./services/k8s-netpol-probe.js");
        const decision = await verifyNetworkPolicyEnforced({
          namespace: this.env.K8S_NAMESPACE,
          allowUnenforced: this.env.NOJV_ALLOW_UNENFORCED_NETWORK_POLICY,
        });
        if (decision.action === "refuse") {
          throw new Error(
            "Refusing to start K8s judge worker: the cluster CNI does not enforce NetworkPolicy, " +
              "so sandbox egress isolation is inert. Enable a NetworkPolicy-enforcing CNI (GKE " +
              "Dataplane V2, Calico, or Cilium), or set NOJV_ALLOW_UNENFORCED_NETWORK_POLICY=1 to " +
              "override (DEV ONLY).",
          );
        }
      }

      const judgeWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: JUDGE_TASK_QUEUE,
        workflowsPath: this.workflowsPath,
        activities: await import("./activities/judge-bundle.js"),
        maxConcurrentActivityTaskExecutions: this.env.WORKER_CONCURRENCY,
        shutdownGraceTime: "30s",
      });
      this.addWorker(judgeWorker, JUDGE_TASK_QUEUE);
      this.assertStarting();
    }

    if (mode === "all" || mode === "platform") {
      const platformWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: PLATFORM_TASK_QUEUE,
        workflowsPath: this.workflowsPath,
        activities: await import("./activities/platform-bundle.js"),
        maxConcurrentActivityTaskExecutions: this.env.WORKER_CONCURRENCY,
        shutdownGraceTime: "30s",
      });
      this.addWorker(platformWorker, PLATFORM_TASK_QUEUE);
      this.assertStarting();
      this.registerTemporalClientCleanup();
      await ensureSubmissionSweeper();
      this.assertStarting();
      await ensureLifecycleReconciler();
      this.assertStarting();
    }

    this.registerTemporalClientCleanup();
    this.cleanupSteps.push({
      resource: "health server",
      run: () => closeServerSafely(this.healthServer),
    });

    await new Promise<void>((resolve) => {
      this.healthServer.listen(this.env.PORT, () => resolve());
    });
    this.assertStarting();

    const singleModeQueue = mode === "judge" ? JUDGE_TASK_QUEUE : PLATFORM_TASK_QUEUE;
    const taskQueues = this.workers.map((_, i) =>
      mode === "all" ? [JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE][i] : singleModeQueue,
    );

    logger.info("temporal worker started", {
      address,
      mode,
      namespace,
      taskQueues: taskQueues.join(", "),
    });
  }

  shutdown(signal: string): Promise<CleanupReport> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.stopping = true;
    this.executorOwner?.abortActive(
      new DOMException(`Worker received ${signal}.`, "AbortError"),
    );

    logger.info("shutting down", { signal });

    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<CleanupReport> {
    const deadline = Date.now() + this.shutdownTimeoutMs;
    const startupReport = this.initializationPromise
      ? await settleCleanupSteps(
          [
            {
              resource: "worker startup",
              run: () => this.initializationPromise?.catch(() => undefined),
            },
          ],
          this.shutdownTimeoutMs,
        )
      : { complete: true, issues: [] };
    const cleanupReport = await settleCleanupSteps(
      [...this.cleanupSteps].reverse(),
      Math.max(0, deadline - Date.now()),
    );
    const issues = [...startupReport.issues, ...cleanupReport.issues];
    const report = { complete: issues.length === 0, issues };
    if (!report.complete) {
      logger.error("cleanup incomplete", {
        issues,
      });
    }
    return report;
  }

  private assertStarting(): void {
    if (this.stopping) throw new Error("Worker startup interrupted by shutdown.");
  }

  private registerTemporalClientCleanup(): void {
    if (this.cleanupSteps.some(({ resource }) => resource === "Temporal client")) return;
    this.cleanupSteps.push({ resource: "Temporal client", run: closeTemporalClient });
  }

  private addWorker(worker: Worker, taskQueue: string): void {
    const managed: ManagedWorker = { worker, runPromise: null };
    this.workers.push(managed);
    this.cleanupSteps.push({
      resource: `Temporal worker ${taskQueue}`,
      run: async () => {
        let shutdownError: unknown;
        try {
          worker.shutdown();
        } catch (error) {
          if (!(error instanceof Error && /DRAINING|STOPPED|STOPPING/.test(error.message))) {
            shutdownError =
              error instanceof Error
                ? error
                : new Error("Temporal worker shutdown failed.", { cause: error });
          }
        }
        if (managed.runPromise) {
          try {
            await managed.runPromise;
          } catch (error) {
            logger.warn("worker run() rejected during drain", {
              err: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (shutdownError instanceof Error) throw shutdownError;
      },
    });
  }
}
