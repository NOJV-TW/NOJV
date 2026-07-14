import { submissionRepo, type TransactionClient } from "@nojv/db";

import { ForbiddenError } from "./errors";

export async function enforceSubmitCooldown(
  tx: TransactionClient,
  context: { examId: string } | { contestId: string },
  userId: string,
  problemId: string,
  cooldownSec: number,
  now: Date = new Date(),
) {
  if (cooldownSec <= 0) return;

  const contextId = "examId" in context ? context.examId : context.contestId;
  const lockKey = `${contextId}:${userId}:${problemId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const cutoff = new Date(now.getTime() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    ...context,
    userId,
    problemId,
    sampleOnly: false,
    createdAt: { gte: cutoff },
  });

  if (recentSubmission) {
    const waitUntil = new Date(recentSubmission.createdAt.getTime() + cooldownSec * 1000);
    const remainingSec = Math.ceil((waitUntil.getTime() - now.getTime()) / 1000);
    throw new ForbiddenError(
      `Submit cooldown active. Please wait ${String(remainingSec)} seconds.`,
    );
  }
}
