import { problemPrefix, sumSizesByPrefix } from "@nojv/storage";

import { ConflictError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";

export const PROBLEM_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

export async function assertProblemStorageBudget(
  problemId: string,
  deltaBytes: number,
): Promise<void> {
  if (deltaBytes < 0) {
    throw new Error("assertProblemStorageBudget: deltaBytes must be non-negative");
  }
  const current = await sumSizesByPrefix(storage(), problemPrefix(problemId));
  if (current + deltaBytes > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Problem ${problemId} storage budget exceeded: ${String(current + deltaBytes)} > ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes.`,
    );
  }
}

export async function getProblemStorageUsage(
  problemId: string,
): Promise<{ used: number; limit: number }> {
  const used = await sumSizesByPrefix(storage(), problemPrefix(problemId));
  return { used, limit: PROBLEM_STORAGE_BUDGET_BYTES };
}
