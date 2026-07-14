import type { Server } from "node:http";

export interface CleanupIssue {
  resource: string;
  reason: string;
}

export interface CleanupReport {
  complete: boolean;
  issues: CleanupIssue[];
}

export interface CleanupStep {
  resource: string;
  run: () => Promise<void> | void;
}

interface LifecycleLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

interface ProcessLifecycleOptions {
  start: () => Promise<void>;
  shutdown: (reason: string) => Promise<CleanupReport | undefined>;
  shutdownTelemetry: () => Promise<void>;
  exit: (code: number) => void;
  logger: LifecycleLogger;
  timeoutMs: number;
}

class CleanupTimeoutError extends Error {
  constructor(resource: string) {
    super(`${resource} timed out`);
    this.name = "CleanupTimeoutError";
  }
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return "Unknown error";
}

function withinTimeout(
  operation: Promise<void>,
  resource: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CleanupTimeoutError(resource)), timeoutMs);
    operation.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(describeUnknown(error)));
      },
    );
  });
}

export async function settleCleanupSteps(
  steps: readonly CleanupStep[],
  timeoutMs: number,
): Promise<CleanupReport> {
  const deadline = Date.now() + timeoutMs;
  const issues: CleanupIssue[] = [];

  for (const step of steps) {
    const operation = Promise.resolve().then(step.run);
    const remainingMs = Math.max(0, deadline - Date.now());
    const [result] = await Promise.allSettled([
      withinTimeout(operation, step.resource, remainingMs),
    ]);
    if (result.status === "fulfilled") continue;
    issues.push({
      resource: step.resource,
      reason:
        result.reason instanceof CleanupTimeoutError
          ? "timed out"
          : result.reason instanceof Error
            ? result.reason.message
            : describeUnknown(result.reason),
    });
  }

  return { complete: issues.length === 0, issues };
}

export function createProcessLifecycle(options: ProcessLifecycleOptions) {
  let exitCode = 0;
  let terminationPromise: Promise<void> | null = null;

  const terminate = (
    reason: string,
    requestedExitCode: 0 | 1,
    error?: unknown,
  ): Promise<void> => {
    exitCode = Math.max(exitCode, requestedExitCode);
    if (error !== undefined) {
      options.logger.error(reason, {
        err: describeUnknown(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    if (terminationPromise) return terminationPromise;

    options.logger.info("worker process stopping", { reason, requestedExitCode });
    terminationPromise = (async () => {
      const workerIssues: CleanupIssue[] = [];
      const report = await settleCleanupSteps(
        [
          {
            resource: "worker application",
            run: async () => {
              const workerReport = await options.shutdown(reason);
              if (workerReport) workerIssues.push(...workerReport.issues);
            },
          },
          { resource: "telemetry", run: options.shutdownTelemetry },
        ],
        options.timeoutMs,
      );
      const issues = report.issues.concat(workerIssues);
      if (issues.length > 0) {
        options.logger.error(
          "cleanup incomplete; executor cancellation is outside this lifecycle cleanup",
          { issues },
        );
      }
      options.exit(exitCode);
    })();
    return terminationPromise;
  };

  return {
    async start(): Promise<void> {
      try {
        await options.start();
      } catch (error) {
        if (terminationPromise) {
          await terminationPromise;
          return;
        }
        await terminate("startup failure", 1, error);
        return;
      }
      if (terminationPromise) {
        await terminationPromise;
        return;
      }
      await terminate("worker stopped unexpectedly", 1);
    },
    signal(signal: "SIGINT" | "SIGTERM"): Promise<void> {
      return terminate(signal, 0);
    },
    fatal(reason: string, error: unknown): Promise<void> {
      return terminate(reason, 1, error);
    },
  };
}

export async function closeServerSafely(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
