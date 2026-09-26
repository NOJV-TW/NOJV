import type { ExecutorOwner } from "../sandbox/shared/executor-owner";

let _executorOwner: ExecutorOwner | undefined;

export function setExecutorOwner(executorOwner: ExecutorOwner): void {
  _executorOwner = executorOwner;
}

export function getExecutorOwner(): ExecutorOwner {
  if (!_executorOwner) throw new Error("Executor owner not initialized");
  return _executorOwner;
}
