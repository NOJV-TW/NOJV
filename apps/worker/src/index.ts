import { parseWorkerEnv } from "./env";
import { createLogger } from "./logger.js";
import { WorkerApp } from "./worker-app";

const processLogger = createLogger("process");

process.on("unhandledRejection", (reason) => {
  processLogger.warn("Unhandled promise rejection", {
    err: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

process.on("uncaughtException", (err) => {
  processLogger.error("Uncaught exception — exiting", {
    err: err.message,
    stack: err.stack
  });
  process.exit(1);
});

const env = parseWorkerEnv(process.env);
const app = new WorkerApp(env);

await app.start();

process.on("SIGINT", () => {
  void app.shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void app.shutdown("SIGTERM").then(() => process.exit(0));
});
