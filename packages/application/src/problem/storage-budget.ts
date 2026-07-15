import { problemRepo } from "@nojv/db";

import { ConflictError } from "../shared/errors";

export const PROBLEM_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

export async function assertProblemStorageBudget(
  problemId: string,
  deltaBytes: number,
): Promise<void> {
  if (deltaBytes < 0) {
    throw new Error("assertProblemStorageBudget: deltaBytes must be non-negative");
  }
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new Error(`Problem not found: ${problemId}`);
  const current = problem.activeStorageBytes;
  if (current + deltaBytes > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Problem ${problemId} storage budget exceeded: ${String(current + deltaBytes)} > ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes.`,
    );
  }
}

export async function getProblemStorageUsage(
  problemId: string,
): Promise<{ used: number; limit: number }> {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new Error(`Problem not found: ${problemId}`);
  return { used: problem.activeStorageBytes, limit: PROBLEM_STORAGE_BUDGET_BYTES };
}
