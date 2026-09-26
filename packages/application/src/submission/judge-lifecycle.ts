import type { AdvancedJudgeVerificationSnapshot, SubmissionResult } from "@nojv/core";
import { Prisma, runTransaction, submissionRepo } from "@nojv/db";
import {
  assertStorageObjectPointer,
  putImmutableObject,
  storagePointerFor,
  submissionVerdictDetailKey,
} from "@nojv/storage";
import { storage } from "../shared/storage-singleton";
import { toJsonValue } from "../shared/to-json-value";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import type { CompletedSubmission } from "./types";
import { deriveVerdictSummary } from "./verdict-summary";

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
