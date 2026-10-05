import { DEFAULT_SUBMIT_COOLDOWN_MIN_SEC, submitCooldownMinSecSchema } from "@nojv/core";
import { submissionRepo, type SubmissionCreateContext, type TransactionClient } from "@nojv/db";

import { ForbiddenError } from "./errors";

export function getSubmitCooldownFloorSec(): number {
  const parsed = submitCooldownMinSecSchema.safeParse(process.env.SUBMIT_COOLDOWN_MIN_SEC);
  return parsed.success ? parsed.data : DEFAULT_SUBMIT_COOLDOWN_MIN_SEC;
}

function cooldownScope(context: SubmissionCreateContext) {
  switch (context.type) {
    case "exam":
      return { key: context.examId, where: { examId: context.examId } };
    case "contest":
      return { key: context.contestId, where: { contestId: context.contestId } };
    case "assignment":
      return { key: context.assessmentId, where: { assessmentId: context.assessmentId } };
    case "virtual":
      return {
        key: context.participationId,
        where: { participationId: context.participationId },
      };
    case "practice":
      return {
        key: "practice",
        where: {
          examId: null,
          contestId: null,
          assessmentId: null,
          participationId: null,
          isReferenceSolution: false,
        },
      };
  }
}

export async function enforceSubmitCooldown(
  tx: TransactionClient,
  context: SubmissionCreateContext,
  userId: string,
  problemId: string,
  cooldownSec: number,
  now: Date = new Date(),
) {
  if (cooldownSec <= 0) return;

  const scope = cooldownScope(context);
  const lockKey = `${scope.key}:${userId}:${problemId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const cutoff = new Date(now.getTime() - cooldownSec * 1000);

  const recentSubmission = await submissionRepo.withTx(tx).findMostRecent({
    ...scope.where,
    userId,
    problemId,
    sampleOnly: false,
    status: { not: "system_error" },
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
