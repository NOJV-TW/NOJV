import { createStorageClient, problemPrefix, sumSizesByPrefix } from "@nojv/storage";

import { ConflictError } from "../shared/errors";

// Inferred to avoid pulling @aws-sdk/client-s3 into @nojv/domain.
type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

function getClient(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}

/**
 * Hard cap on aggregate S3 usage under `problems/{id}/` — covers testcases,
 * workspace files, checker/interactor scripts, and any future per-problem
 * blobs. Pre-production sizing; revisit when real-world authoring pushes
 * against it.
 */
export const PROBLEM_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

/**
 * Reject the in-flight upload when the new bytes would push the problem
 * over the budget. Sums via LIST (no per-key HEAD), so a single S3 call
 * suffices for problems with the usual handful of objects.
 *
 * Caller MUST have already asserted problem-edit access — this helper
 * only enforces quota.
 */
export async function assertProblemStorageBudget(
  problemId: string,
  deltaBytes: number,
): Promise<void> {
  if (deltaBytes < 0) {
    throw new Error("assertProblemStorageBudget: deltaBytes must be non-negative");
  }
  const current = await sumSizesByPrefix(getClient(), problemPrefix(problemId));
  if (current + deltaBytes > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Problem ${problemId} storage budget exceeded: ${String(current + deltaBytes)} > ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes.`,
    );
  }
}

/**
 * Non-throwing counterpart to `assertProblemStorageBudget` — returns the
 * current aggregate byte usage under `problems/{id}/` so the authoring UI
 * can render a "X / 50 MB" indicator.
 */
export async function getProblemStorageUsage(
  problemId: string,
): Promise<{ used: number; limit: number }> {
  const used = await sumSizesByPrefix(getClient(), problemPrefix(problemId));
  return { used, limit: PROBLEM_STORAGE_BUDGET_BYTES };
}
