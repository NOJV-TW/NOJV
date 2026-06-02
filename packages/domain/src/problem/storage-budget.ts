import { createStorageClient, problemPrefix, sumSizesByPrefix } from "@nojv/storage";

import { ConflictError } from "../shared/errors";

type StorageClient = ReturnType<typeof createStorageClient>;

let cachedClient: StorageClient | null = null;

function getClient(): StorageClient {
  cachedClient ??= createStorageClient();
  return cachedClient;
}

export const PROBLEM_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

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

export async function getProblemStorageUsage(
  problemId: string,
): Promise<{ used: number; limit: number }> {
  const used = await sumSizesByPrefix(getClient(), problemPrefix(problemId));
  return { used, limit: PROBLEM_STORAGE_BUDGET_BYTES };
}
