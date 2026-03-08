import { Worker } from "bullmq";

import { queueNames } from "@nojv/queue";

import { parseWorkerEnv } from "./env";
import { createWorkerHealthServer } from "./health-server";
import { closeServerSafely } from "./server-lifecycle";
import { processCheatingSignal, processSubmission, processWorkspaceRun } from "./processors";

const environment = parseWorkerEnv(process.env);
const redis = new URL(environment.REDIS_URL);
const connection = {
  host: redis.hostname,
  maxRetriesPerRequest: null,
  password: redis.password || undefined,
  port: Number(redis.port || "6379")
};

const workers = [
  new Worker(queueNames.submission, processSubmission, {
    concurrency: environment.WORKER_CONCURRENCY,
    connection
  }),
  new Worker(queueNames.workspaceRun, processWorkspaceRun, {
    concurrency: environment.WORKER_CONCURRENCY,
    connection
  }),
  new Worker(queueNames.cheatingSignal, processCheatingSignal, {
    concurrency: environment.WORKER_CONCURRENCY,
    connection
  })
];
const healthServer = createWorkerHealthServer();
let shutdownPromise: Promise<void> | null = null;

for (const worker of workers) {
  worker.on("completed", (job, result) => {
    console.log(`[worker] completed ${job.name}`, result);
  });

  worker.on("failed", (job, error) => {
    console.error(`[worker] failed ${job?.name ?? "unknown"}`, error);
  });
}

await Promise.all(workers.map((worker) => worker.waitUntilReady()));
await new Promise<void>((resolve) => {
  healthServer.listen(environment.PORT, () => {
    resolve();
  });
});

console.log(
  `[worker] listening on ${environment.REDIS_URL} with queues: ${Object.values(queueNames).join(", ")}`
);
console.log(`[worker] health endpoint listening on port ${String(environment.PORT)}`);

async function shutdown(signal: string) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  console.log(`[worker] shutting down due to ${signal}`);

  shutdownPromise = (async () => {
    await closeServerSafely(healthServer);
    await Promise.all(workers.map((worker) => worker.close()));
  })();

  await shutdownPromise;
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
