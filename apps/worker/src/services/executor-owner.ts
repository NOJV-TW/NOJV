import { randomUUID } from "node:crypto";

import type {
  SandboxExecutionContext,
  SandboxExecutor,
  SandboxRequest,
  SandboxResult,
} from "@nojv/core";

interface ActiveExecution {
  controller: AbortController;
  promise: Promise<SandboxResult>;
}

export class ExecutorOwner {
  private readonly active = new Set<ActiveExecution>();
  private stopping = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly executor: SandboxExecutor,
    private readonly createRunId: () => string = randomUUID,
  ) {}

  execute(request: SandboxRequest, signal: AbortSignal): Promise<SandboxResult> {
    if (this.stopping) {
      throw new Error("Executor owner is shutting down.");
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal.aborted) {
      forwardAbort();
    } else {
      signal.addEventListener("abort", forwardAbort, { once: true });
    }

    const execution: SandboxExecutionContext = {
      runId: this.createRunId(),
      signal: controller.signal,
    };
    const active = {} as ActiveExecution;
    const promise = Promise.resolve()
      .then(() => this.executor.execute(request, execution))
      .finally(() => {
        signal.removeEventListener("abort", forwardAbort);
        this.active.delete(active);
      });
    active.controller = controller;
    active.promise = promise;
    this.active.add(active);
    return promise;
  }

  abortActive(reason: unknown): void {
    this.stopping = true;
    for (const execution of this.active) {
      execution.controller.abort(reason);
    }
  }

  shutdown(reason: unknown): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.abortActive(reason);
    this.shutdownPromise = Promise.allSettled(
      [...this.active].map(({ promise }) => promise),
    ).then(() => undefined);
    return this.shutdownPromise;
  }

  get activeCount(): number {
    return this.active.size;
  }
}
