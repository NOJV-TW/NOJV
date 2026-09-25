import { failureMessage } from "../shared/failure-message";
import { SandboxCleanupError } from "./errors";

export function throwCleanupFailures(
  label: string,
  results: PromiseSettledResult<unknown>[],
): void {
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => failureMessage(result.reason));
  if (failures.length > 0) {
    throw new Error(`${label} cleanup failed: ${failures.join(" | ")}`);
  }
}

export function combineExecutionAndCleanupFailure(
  executionFailure: unknown,
  cleanupFailure: unknown,
): Error {
  const cleanup = failureMessage(cleanupFailure);
  if (!(executionFailure instanceof Error) || executionFailure.name !== "AbortError") {
    return new SandboxCleanupError(
      `${failureMessage(executionFailure)} Cleanup also failed: ${cleanup}`,
      { cause: cleanupFailure },
    );
  }
  Object.defineProperty(executionFailure, "message", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: `${executionFailure.message} Cleanup also failed: ${cleanup}`,
  });
  return executionFailure;
}

export async function runCleanupAfterExecution(
  executionFailure: { reason: unknown } | undefined,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (cleanupFailure) {
    if (executionFailure !== undefined) {
      throw combineExecutionAndCleanupFailure(executionFailure.reason, cleanupFailure);
    }
    throw new SandboxCleanupError(failureMessage(cleanupFailure), { cause: cleanupFailure });
  }
}

export async function runCleanupOperations(
  label: string,
  operations: Promise<unknown>[],
): Promise<void> {
  const results = await Promise.allSettled(operations);
  throwCleanupFailures(label, results);
}
