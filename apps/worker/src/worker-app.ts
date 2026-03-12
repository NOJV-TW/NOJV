import { Queue, UnrecoverableError, Worker } from "bullmq";

import { parseRedisConnection, queueNames } from "@nojv/queue";

import type { WorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { createLogger } from "./logger.js";
import { createSubmissionProcessor } from "./processors/submission";
import { closeServerSafely } from "./server-lifecycle";
import { createExecutor } from "./services/executor-factory";

const logger = createLogger("worker");

async function mountBullBoard(
  app: ReturnType<typeof createWorkerHealthServer>,
  queues: Queue[]
): Promise<void> {
  const { createBullBoard } = await import("@bull-board/api");
  const { BullMQAdapter } = await import("@bull-board/api/bullMQAdapter");
  const { ExpressAdapter } = await import("@bull-board/express");
  const express = await import("express");

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter
  });

  const expressApp = express.default();
  expressApp.use("/admin/queues", serverAdapter.getRouter());

  // Proxy /admin requests on the health server to express
  const { createServer } = await import("node:http");
  const boardServer = createServer(expressApp);
  const BOARD_PORT = 9999;
  await new Promise<void>((resolve) => {
    boardServer.listen(BOARD_PORT, () => resolve());
  });

  logger.info("bull-board dashboard started", { url: `http://localhost:${BOARD_PORT}/admin/queues` });
}

export class WorkerApp {
  private readonly workers: Worker[];
  private readonly healthServer: ReturnType<typeof createWorkerHealthServer>;
  private readonly env: WorkerEnv;
  private readonly readOnlyQueues: Queue[];
  private shutdownPromise: Promise<void> | null = null;

  constructor(env: WorkerEnv) {
    this.env = env;

    const connection = parseRedisConnection(env.REDIS_URL);

    const executor = createExecutor(env);
    const processSubmission = createSubmissionProcessor(executor);

    this.workers = [
      new Worker(queueNames.submission, processSubmission, {
        concurrency: env.WORKER_CONCURRENCY,
        connection
      })
    ];

    this.readOnlyQueues = [new Queue(queueNames.submission, { connection })];

    this.healthServer = createWorkerHealthServer();

    for (const worker of this.workers) {
      worker.on("completed", (job) => {
        logger.info("job completed", { jobName: job.name });
      });

      worker.on("failed", (job, error) => {
        const prefix = error instanceof UnrecoverableError ? "permanent" : "retryable";
        logger.error(`${prefix} job failure`, { jobName: job?.name ?? "unknown", err: error.message });
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

    if (this.env.NODE_ENV === "development") {
      await mountBullBoard(this.healthServer, this.readOnlyQueues);
    }

    logger.info("worker started", { redis: this.env.REDIS_URL, queues: Object.values(queueNames).join(", ") });
    logger.info("health endpoint started", { port: this.env.PORT });
  }

  async shutdown(signal: string): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    logger.info("shutting down", { signal });

    this.shutdownPromise = (async () => {
      await closeServerSafely(this.healthServer);
      await Promise.all([
        ...this.workers.map((w) => w.close()),
        ...this.readOnlyQueues.map((q) => q.close())
      ]);
    })();

    await this.shutdownPromise;
  }
}
