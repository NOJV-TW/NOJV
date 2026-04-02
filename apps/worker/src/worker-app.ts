import { createRequire } from "node:module";

import { NativeConnection, Worker } from "@temporalio/worker";

import { JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE } from "@nojv/temporal";

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
    this.healthServer = createWorkerHealthServer();
  }

  async start(): Promise<void> {
    const address = this.env.TEMPORAL_ADDRESS;
    const namespace = this.env.TEMPORAL_NAMESPACE;
    const mode = this.env.WORKER_MODE;
    const connection = await NativeConnection.connect({ address });

    if (mode === "all" || mode === "judge") {
      const { setExecutor } = await import("@nojv/temporal/activities/judge");
      const executor = createExecutor(this.env);
      setExecutor(executor);

      const judgeWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: JUDGE_TASK_QUEUE,
        workflowsPath: require.resolve("@nojv/temporal/workflows"),
        activities: await import("@nojv/temporal/activities/judge"),
        maxConcurrentActivityTaskExecutions: this.env.WORKER_CONCURRENCY
      });
      this.workers.push(judgeWorker);
    }

    if (mode === "all" || mode === "platform") {
      const platformWorker = await Worker.create({
        connection,
        namespace,
        taskQueue: PLATFORM_TASK_QUEUE,
        workflowsPath: require.resolve("@nojv/temporal/workflows"),
        activities: await import("@nojv/temporal/activities/platform"),
        maxConcurrentActivityTaskExecutions: 10
      });
      this.workers.push(platformWorker);
    }

    await new Promise<void>((resolve) => {
      this.healthServer.listen(this.env.PORT, () => resolve());
    });

    const taskQueues = this.workers.map((_, i) =>
      mode === "all"
        ? [JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE][i]
        : mode === "judge" ? JUDGE_TASK_QUEUE : PLATFORM_TASK_QUEUE
    );

    logger.info("temporal worker started", {
      address,
      mode,
      namespace,
      taskQueues: taskQueues.join(", ")
    });

    await Promise.all(this.workers.map((w) => w.run()));
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    logger.info("shutting down", { signal });

    this.shutdownPromise = (async () => {
      await closeServerSafely(this.healthServer);
      for (const w of this.workers) {
        w.shutdown();
      }
    })();

    await this.shutdownPromise;
  }
}
