import { shutdownOtel } from "./otel.js"; // Must stay first for auto-instrumentation.

import { getStorageEnv } from "@nojv/storage";

import { parseWorkerEnv } from "./env";
import { createLogger } from "./logger.js";
import { validateWorkerMailerStartup } from "./mailer-startup";
import { createProcessLifecycle } from "./server-lifecycle";
import { WorkerApp } from "./worker-app";

const processLogger = createLogger("process");
let app: WorkerApp | null = null;

const lifecycle = createProcessLifecycle({
  start: async () => {
    const env = parseWorkerEnv(process.env);
    validateWorkerMailerStartup(env.WORKER_MODE);
    getStorageEnv();
    app = new WorkerApp(env);
    await app.start();
  },
  shutdown: (reason) => app?.shutdown(reason) ?? Promise.resolve(undefined),
  shutdownTelemetry: shutdownOtel,
  exit: (code) => process.exit(code),
  logger: processLogger,
  timeoutMs: 40_000,
});

process.on("unhandledRejection", (reason) => {
  void lifecycle.fatal("unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  void lifecycle.fatal("uncaught exception", error);
});
process.on("SIGINT", () => void lifecycle.signal("SIGINT"));
process.on("SIGTERM", () => void lifecycle.signal("SIGTERM"));

await lifecycle.start();
