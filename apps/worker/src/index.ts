import "./otel.js"; // MUST be first — registers auto-instrumentation hooks before any other import loads pg/ioredis/etc.
import { shutdownOtel } from "./otel.js"; // named export for shutdown wiring; ESM caches the module so this does not re-evaluate

import { parseWorkerEnv } from "./env";
import { createLogger } from "./logger.js";
import { WorkerApp } from "./worker-app";

const processLogger = createLogger("process");

process.on("unhandledRejection", (reason) => {
  processLogger.warn("Unhandled promise rejection", {
    err: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (err) => {
  processLogger.error("Uncaught exception — exiting", {
    err: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

const env = parseWorkerEnv(process.env);
const app = new WorkerApp(env);

const gracefulShutdown = async (signal: string) => {
  await app.shutdown(signal);
  await shutdownOtel();
  process.exit(0);
};
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));

await app.start();
