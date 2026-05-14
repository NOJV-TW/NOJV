import { createRequire } from "node:module";

import { NativeConnection, Worker } from "@temporalio/worker";

import { closeTemporalClient, JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE } from "@nojv/temporal";

const require = createRequire(import.meta.url);

import type { WorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { createLogger } from "./logger.js";
import { closeServerSafely } from "./server-lifecycle";
import { createExecutor } from "./services/executor-factory";

const logger = createLogger("worker");

export class WorkerApp {
  private readonly workers: Worker[] = [];
  private readonly healthServer: ReturnType<typeof createWorkerHealthServer>;
  private readonly env: WorkerEnv;
  private shutdownPromise: Promise<void> | null = null;

  constructor(env: WorkerEnv) {
    this.env = env;
    this.healthServer = createWorkerHealthServer({
      redisUrl: env.REDIS_URL,
      // Readiness is derived live from each Worker's `getState()`. A stale
      // boolean would let `/readyz` keep returning 200 after a mid-run
      // disconnect (state would transition to `FAILED` / `STOPPED` but the
      // flag would still read `true`).
      isTemporalConnected: () =>
        this.workers.length > 0 && this.workers.every((w) => w.getState() === "RUNNING"),
    });
  }

  async start(): Promise<void> {
    const address = this.env.TEMPORAL_ADDRESS;
    const namespace = this.env.TEMPORAL_NAMESPACE;
    const mode = this.env.WORKER_MODE;
    const connection = await NativeConnection.connect({ address });

    if (mode === "all" || mode === "judge") {
      const { setExecutor } = await import("./activities/judge.js");
      const executor = createExecutor(this.env);
      setExecutor(executor);

      const judgeWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: JUDGE_TASK_QUEUE,
        workflowsPath: require.resolve("./workflows/index.js"),
        activities: await import("./activities/judge-bundle.js"),
        maxConcurrentActivityTaskExecutions: this.env.WORKER_CONCURRENCY,
      });
      this.workers.push(judgeWorker);
    }

    if (mode === "all" || mode === "platform") {
      const platformWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: PLATFORM_TASK_QUEUE,
        workflowsPath: require.resolve("./workflows/index.js"),
        activities: await import("./activities/platform-bundle.js"),
        maxConcurrentActivityTaskExecutions: 10,
      });
      this.workers.push(platformWorker);
    }

    await new Promise<void>((resolve) => {
      this.healthServer.listen(this.env.PORT, () => resolve());
    });

    const taskQueues = this.workers.map((_, i) =>
      mode === "all"
        ? [JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE][i]
        : mode === "judge"
          ? JUDGE_TASK_QUEUE
          : PLATFORM_TASK_QUEUE,
    );

    logger.info("temporal worker started", {
      address,
      mode,
      namespace,
      taskQueues: taskQueues.join(", "),
    });

    await Promise.all(this.workers.map((w) => w.run()));
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    logger.info("shutting down", { signal });

    this.shutdownPromise = (async () => {
      await closeServerSafely(this.healthServer);
      for (const w of this.workers) {
        // Swallow "Not running. Current state: DRAINING" when a second
        // signal races the first shutdown — e.g. under `node --watch`
        // hot-restart the SIGTERM arrives while the worker is already
        // draining from a prior shutdown call.
        try {
          w.shutdown();
        } catch (err) {
          if (err instanceof Error && /DRAINING|STOPPED|STOPPING/.test(err.message)) {
            continue;
          }
          throw err;
        }
      }
      // Close the shared dispatch-side Temporal client so the process can
      // exit cleanly. The worker uses `NativeConnection` (closed by
      // `Worker.shutdown()`); this drops the high-level client kept alive
      // by `@nojv/temporal` dispatch helpers.
      await closeTemporalClient();
    })();

    await this.shutdownPromise;
  }
}
