import { validateMailerConfig } from "@nojv/mailer";

import type { WorkerEnv } from "./env";

export function validateWorkerMailerStartup(mode: WorkerEnv["WORKER_MODE"]): void {
  if (mode !== "judge") {
    validateMailerConfig();
  }
}
