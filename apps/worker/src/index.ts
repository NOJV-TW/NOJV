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

// Signal handlers MUST be registered before `await app.start()`. start()
// blocks on each worker's run() promise, which only resolves after
// shutdown is triggered — so any handler registered after the await
// wouldn't exist until workers had already stopped, leaving the default
// Node behavior (immediate kill) to handle every SIGTERM/SIGINT in
// production. That would skip closeServerSafely, skip worker.shutdown(),
// and leave in-flight activities without the chance to drain.
const gracefulShutdown = (signal: string) => {
  void app.shutdown(signal).then(() => process.exit(0));
};
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

await app.start();
