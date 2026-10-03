import { prismaAdapterClient, type TransactionClient } from "@nojv/db";

import { ConflictError, NotFoundError } from "../shared/errors";
import { ensureProblemImageInventory } from "../shared/uploaded-image";

export const PROBLEM_STORAGE_BUDGET_BYTES = 50 * 1024 * 1024;

export async function assertProblemStorageBudget(
  problemId: string,
  deltaBytes: number,
  tx?: TransactionClient,
): Promise<void> {
  const client = tx ?? prismaAdapterClient;
  const problem = await client.problem.findUnique({ where: { id: problemId } });
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  const images = await client.uploadedImage.aggregate({
    where: { problemId },
    _sum: { size: true },
  });
  const projected = problem.activeStorageBytes + (images._sum.size ?? 0) + deltaBytes;
  if (deltaBytes > 0 && projected > PROBLEM_STORAGE_BUDGET_BYTES) {
    throw new ConflictError(
      `Problem ${problemId} storage budget exceeded: ${String(projected)} > ${String(PROBLEM_STORAGE_BUDGET_BYTES)} bytes.`,
    );
  }
}

export async function getProblemStorageUsage(
  problemId: string,
): Promise<{ used: number; limit: number }> {
  await ensureProblemImageInventory(problemId);
  const problem = await prismaAdapterClient.problem.findUnique({ where: { id: problemId } });
  if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
  const images = await prismaAdapterClient.uploadedImage.aggregate({
    where: { problemId },
    _sum: { size: true },
  });
  return {
    used: problem.activeStorageBytes + (images._sum.size ?? 0),
    limit: PROBLEM_STORAGE_BUDGET_BYTES,
  };
}
