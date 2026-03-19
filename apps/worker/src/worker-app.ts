import { Queue, UnrecoverableError, Worker } from "bullmq";

import { defaultJobOptions, parseRedisConnection, queueNames } from "@nojv/core";

import type { WorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { createLogger } from "./logger.js";
import { createSubmissionProcessor } from "./processors/submission";
import { closeServerSafely } from "./server-lifecycle";
import { createExecutor } from "./services/executor-factory";

const logger = createLogger("worker");

export class WorkerApp {
  private readonly workers: Worker[];
  private readonly healthServer: ReturnType<typeof createWorkerHealthServer>;
  private readonly env: WorkerEnv;
  private readonly dlqQueue: Queue;
  private shutdownPromise: Promise<void> | null = null;

  constructor(env: WorkerEnv) {
    this.env = env;

    const connection = parseRedisConnection(env.REDIS_URL);

    const executor = createExecutor(env);
    const processSubmission = createSubmissionProcessor(executor);

    this.dlqQueue = new Queue(queueNames.submissionDlq, { connection });

    this.workers = [
      new Worker(queueNames.submission, processSubmission, {
        concurrency: env.WORKER_CONCURRENCY,
        connection
      })
    ];

    this.healthServer = createWorkerHealthServer();

    for (const worker of this.workers) {
      worker.on("completed", (job) => {
        logger.info("job completed", { jobName: job.name });
      });

      worker.on("failed", (job, error) => {
        const prefix = error instanceof UnrecoverableError ? "permanent" : "retryable";
        logger.error(`${prefix} job failure`, {
          jobName: job?.name ?? "unknown",
          err: error.message
        });

        if (job && job.attemptsMade >= (job.opts.attempts ?? defaultJobOptions.attempts)) {
          this.dlqQueue
            .add("failed-submission", {
              originalJobId: job.id,
              data: job.data as Record<string, unknown>,
              failedReason: error.message,
              failedAt: new Date().toISOString()
            })
            .catch((dlqError: unknown) => {
              logger.error("failed to enqueue to DLQ", { err: String(dlqError) });
            });
        }
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

    logger.info("worker started", {
      redis: this.env.REDIS_URL,
      queues: Object.values(queueNames).join(", ")
    });
    logger.info("health endpoint started", { port: this.env.PORT });
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    logger.info("shutting down", { signal });

    this.shutdownPromise = (async () => {
      await closeServerSafely(this.healthServer);
      await Promise.all([...this.workers.map((w) => w.close()), this.dlqQueue.close()]);
    })();

    await this.shutdownPromise;
  }
}
