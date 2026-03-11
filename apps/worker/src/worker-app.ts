import { Worker } from "bullmq";

import { queueNames } from "@nojv/core";

import type { WorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { processCheatingSignal } from "./processors/cheating-signal";
import { createSubmissionProcessor } from "./processors/submission";
import { closeServerSafely } from "./server-lifecycle";
import { createExecutor } from "./services/executor-factory";

export class WorkerApp {
  private readonly workers: Worker[];
  private readonly healthServer: ReturnType<typeof createWorkerHealthServer>;
  private readonly env: WorkerEnv;
  private shutdownPromise: Promise<void> | null = null;

  constructor(env: WorkerEnv) {
    this.env = env;

    const redis = new URL(env.REDIS_URL);
    const connection = {
      host: redis.hostname,
      maxRetriesPerRequest: null,
      password: redis.password || undefined,
      port: Number(redis.port || "6379")
    };

    const executor = createExecutor(env);
    const processSubmission = createSubmissionProcessor(executor);

    this.workers = [
      new Worker(queueNames.submission, processSubmission, {
        concurrency: env.WORKER_CONCURRENCY,
        connection
      }),
      new Worker(queueNames.cheatingSignal, processCheatingSignal, {
        concurrency: env.WORKER_CONCURRENCY,
        connection
      })
    ];

    this.healthServer = createWorkerHealthServer();

    for (const worker of this.workers) {
      worker.on("completed", (job, result) => {
        console.log(`[worker] completed ${job.name}`, result);
      });

      worker.on("failed", (job, error) => {
        console.error(`[worker] failed ${job?.name ?? "unknown"}`, error);
      });
    }
  }

  async start(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
    await new Promise<void>((resolve) => {
      this.healthServer.listen(this.env.PORT, () => {
        resolve();
      });
    });

    console.log(
      `[worker] listening on ${this.env.REDIS_URL} with queues: ${Object.values(queueNames).join(", ")}`
    );
    console.log(`[worker] health endpoint listening on port ${String(this.env.PORT)}`);
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    console.log(`[worker] shutting down due to ${signal}`);

    this.shutdownPromise = (async () => {
      await closeServerSafely(this.healthServer);
      await Promise.all(this.workers.map((w) => w.close()));
    })();

    await this.shutdownPromise;
  }
}
