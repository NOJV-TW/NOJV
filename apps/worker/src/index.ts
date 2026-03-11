import { parseWorkerEnv } from "./env";
import { WorkerApp } from "./worker-app";

const env = parseWorkerEnv(process.env);
const app = new WorkerApp(env);

await app.start();

process.on("SIGINT", () => {
  void app.shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void app.shutdown("SIGTERM").then(() => process.exit(0));
});
