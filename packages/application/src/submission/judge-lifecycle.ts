import type {
  AdvancedJudgeVerificationSnapshot,
  SubmissionOperationStatus,
  SubmissionResult,
} from "@nojv/core";
import { Prisma, runTransaction, submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";
import {
  assertStorageObjectPointer,
  putImmutableObject,
  storagePointerFor,
  submissionVerdictDetailKey,
} from "@nojv/storage";
import { ConflictError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { toJsonValue } from "../shared/to-json-value";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import type { CompletedSubmission } from "./types";
import { deriveSystemErrorVerdictSummary, deriveVerdictSummary } from "./verdict-summary";

type SubmissionStatus = SubmissionOperationStatus;

export async function startSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const submission = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);
    if (submission.activeJudgeRunId === judgeRunId) return;
    if (!["queued", "compiling", "running"].includes(submission.status)) {
      throw new ConflictError("This submission cannot start a legacy judge run.");
    }
    if (submission.activeJudgeRunId !== null) {
      throw new ConflictError(`Submission ${submissionId} already has an active judge run.`);
    }
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        activeJudgeRunId: judgeRunId,
        judgeGeneration: { increment: 1 },
        status: "running",
      },
    });
  });
}

export async function failSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
  reason: string,
): Promise<boolean> {
  return runTransaction(async (tx) => {
    const { count } = await tx.submission.updateMany({
      where: {
        id: submissionId,
        activeJudgeRunId: judgeRunId,
        status: { in: ["queued", "compiling", "running"] },
      },
      data: {
        activeJudgeRunId: null,
        status: "system_error",
        verdictSummary: toJsonValue(deriveSystemErrorVerdictSummary(reason)),
      },
    });
    return count === 1;
  });
}

export async function restoreSubmissionAfterCancelledRejudge(
  submissionId: string,
  judgeRunId: string,
  oldStatus: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    await tx.submission.updateMany({
      where: {
        id: submissionId,
        activeJudgeRunId: judgeRunId,
        status: { in: ["queued", "running"] },
      },
      data: {
        activeJudgeRunId: null,
        status: oldStatus as SubmissionStatus,
      },
    });
  });
}

export async function completeJudge(
  submissionId: string,
  judgeRunId: string,
  result: SubmissionResult,
  advancedConfigSnapshot: AdvancedJudgeVerificationSnapshot | null = null,
): Promise<CompletedSubmission | null> {
  const preflight = await submissionRepo.findById(submissionId);
  if (preflight?.activeJudgeRunId !== judgeRunId) return null;
  const verdictBody = Buffer.from(JSON.stringify(result), "utf8");
  const verdictDetailStorage = storagePointerFor(
    submissionVerdictDetailKey(submissionId, judgeRunId),
    verdictBody,
  );
  await guardStorageObjectWrites([verdictDetailStorage]);
  await putImmutableObject(storage(), verdictDetailStorage.key, verdictBody, {
    contentType: "application/json",
  });

  const verdictSummary = deriveVerdictSummary(result);
  const submission = await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${preflight.problemId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (
      current?.activeJudgeRunId !== judgeRunId ||
      (!["queued", "compiling", "running"].includes(current.status) &&
        !judgeRunId.startsWith("judge-execution-"))
    ) {
      return null;
    }
    const updated = await tx.submission.update({
      where: { id: submissionId },
      data: {
        activeJudgeRunId: null,
        runtimeMs: result.runtimeMs,
        ...(result.memoryKb !== undefined ? { memoryKb: result.memoryKb } : {}),
        score: result.score,
        status: result.verdict,
        verdictSummary: toJsonValue(verdictSummary),
        verdictDetailStorage,
        advancedConfigSnapshot:
          advancedConfigSnapshot === null
            ? Prisma.JsonNull
            : toJsonValue(advancedConfigSnapshot),
      },
    });
    if (current.isReferenceSolution) {
      const problem = await tx.problem.findUnique({
        where: { id: current.problemId },
        select: { storageGeneration: true },
      });
      const latestReference = await tx.submission.findFirst({
        where: { problemId: current.problemId, isReferenceSolution: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (
        problem?.storageGeneration === current.referenceProblemStorageGeneration &&
        latestReference?.id === current.id
      ) {
        await tx.problem.update({
          where: { id: current.problemId },
          data: {
            referenceSolutionSubmissionId: result.verdict === "accepted" ? current.id : null,
          },
        });
      }
    }
    await commitStoragePointerSwap(tx, {
      added: [verdictDetailStorage],
      removed:
        current.verdictDetailStorage === null
          ? []
          : [assertStorageObjectPointer(current.verdictDetailStorage)],
    });
    return updated;
  });
  if (!submission) return null;

  return {
    contestId: submission.contestId,
    examId: submission.examId,
    createdAt: submission.createdAt,
    id: submission.id,
    language: submission.language,
    problemId: submission.problemId,
    sampleOnly: submission.sampleOnly,
    score: submission.score,
    status: submission.status,
    userId: submission.userId,
  };
}

export async function snapshotForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
  rejudgeRunId: string,
  expectedJudgeGeneration: number | null = null,
): Promise<{ logId: string; oldStatus: string } | null> {
  return runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!current) return null;
    if (
      expectedJudgeGeneration !== null &&
      (current.status !== "system_error" || current.judgeGeneration !== expectedJudgeGeneration)
    ) {
      return null;
    }
    if (current.activeJudgeRunId !== null && current.activeJudgeRunId !== rejudgeRunId) {
      throw new ConflictError(`Submission ${submissionId} already has an active judge run.`);
    }
    const row = await tx.submissionRejudgeLog.upsert({
      where: {
        submissionId_rejudgeRunId: { submissionId, rejudgeRunId },
      },
      create: {
        submissionId,
        rejudgedByUserId: triggeredByUserId,
        rejudgeRunId,
        oldVerdict: current.status,
        oldScore: current.score,
        oldResultJson:
          current.verdictSummary === null
            ? Prisma.JsonNull
            : toJsonValue(current.verdictSummary),
      },
      update: {},
    });
    if (current.activeJudgeRunId === null) {
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          activeJudgeRunId: rejudgeRunId,
          judgeGeneration: { increment: 1 },
          status: "running",
        },
      });
    }
    return { logId: row.id, oldStatus: row.oldVerdict };
  });
}

export async function finalizeRejudgeLog(
  submissionId: string,
  _triggeredByUserId: string | null,
  logId: string,
  judgeRunId: string,
): Promise<void> {
  const updated = await submissionRepo.findById(submissionId);
  if (!updated) return;
  const log = await submissionRejudgeLogRepo.findById(logId);
  if (log?.submissionId !== submissionId || log.rejudgeRunId !== judgeRunId) return;
  const verdictPointer =
    updated.verdictDetailStorage === null
      ? null
      : assertStorageObjectPointer(updated.verdictDetailStorage);
  if (!verdictPointer?.key.includes(`/judge-runs/${judgeRunId}/`)) return;
  await submissionRejudgeLogRepo.update(logId, {
    newVerdict: updated.status,
    newScore: updated.score,
    newResultJson: updated.verdictSummary === null ? null : toJsonValue(updated.verdictSummary),
  });
}
