import { randomUUID } from "node:crypto";

import {
  courseMembershipRepo,
  examRepo,
  examSessionRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRejudgeLogRepo,
  submissionRepo,
} from "@nojv/db";
import {
  entryFileNameFor,
  validateRequiredPaths,
  type SubmissionDraft,
  type SubmissionResult,
  type VerdictSummary,
} from "@nojv/core";
import {
  deleteSubmissionStorage,
  getVerdictDetail as storageGetVerdictDetail,
  putSubmissionSources,
  putVerdictDetail,
  submissionSourcePrefix,
  submissionVerdictDetailKey,
} from "@nojv/storage";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { toJsonValue } from "../shared/to-json-value";
import { ensureUser } from "../user/mutations";
import { requireCourseAssignment, requireProblem } from "../shared/require";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { checkExamSubmitCooldown } from "../exam/mutations";
import { assertCanSubmitToVirtualContest } from "../virtual-contest/queries";
import { assertProblemViewAccess } from "../problem/permissions";
import { normalizeSubmissionSources } from "./source-paths";
import type { CompletedSubmission } from "./types";

export type { ActorContext };

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string,
) {
  const submissionId = randomUUID();

  const { row, sources } = await runTransaction(async (tx) => {
    const [problem, courseContext, user, activeExamSession] = await Promise.all([
      requireProblem(tx, payload.problemId),
      payload.assessment
        ? requireCourseAssignment(
            tx,
            payload.assessment.courseId,
            payload.assessment.assessmentId,
          )
        : null,
      ensureUser(tx, actor.userId, actor),
      examSessionRepo.withTx(tx).findActiveForUser(actor.userId),
    ]);

    if (activeExamSession && actor.platformRole !== "admin") {
      if (courseContext || payload.contestId || payload.virtualContestId) {
        throw new ForbiddenError(
          "You are in an active exam — submissions cannot carry an external assignment or contest context.",
        );
      }

      const exam = await examRepo.withTx(tx).findById(activeExamSession.examId);
      if (exam && new Date() >= exam.endsAt) {
        throw new ForbiddenError("Exam has ended.");
      }

      if (exam && !payload.sampleOnly && exam.submitCooldownSec > 0) {
        await checkExamSubmitCooldown(tx, exam.id, user.id, problem.id, exam.submitCooldownSec);
      }
    }

    if (payload.virtualContestId) {
      if (courseContext || payload.contestId) {
        throw new ForbiddenError(
          "A virtual-contest submission cannot also carry a contest or assignment context.",
        );
      }
      await assertCanSubmitToVirtualContest(payload.virtualContestId, actor.userId, problem.id);
    }

    if (courseContext) {
      const membership = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(courseContext.course.id, actor.userId);

      if (membership?.status !== "active") {
        throw new ForbiddenError("You are not enrolled in this course.");
      }

      const assignment = courseContext.assignment;
      if (assignment.status !== "published") {
        throw new NotFoundError("Assignment not found.");
      }
      if (actor.platformRole !== "admin" && membership.role === "student") {
        const now = new Date();
        if (now < assignment.opensAt) {
          throw new ForbiddenError("Assignment has not opened yet.");
        }
        if (now > assignment.closesAt) {
          throw new ForbiddenError("Assignment has ended.");
        }
      }

      const link = await tx.courseAssessmentProblem.findFirst({
        where: { assessmentId: assignment.id, problemId: problem.id },
        select: { id: true },
      });
      if (!link) {
        throw new ForbiddenError("This problem is not part of the assignment.");
      }
    }

    const contestResult = payload.contestId
      ? await ensureContestParticipation(tx, user.id, payload.contestId, {
          problemId: problem.id,
          sampleOnly: payload.sampleOnly ?? false,
        })
      : null;
    const contestParticipation = contestResult?.participation ?? null;

    if (contestResult) {
      const link = await tx.contestProblem.findFirst({
        where: { contestId: contestResult.contest.id, problemId: problem.id },
        select: { id: true },
      });
      if (!link) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
    }

    const contextIncludesProblem = Boolean(courseContext) || Boolean(contestResult);
    await assertProblemViewAccess(problem, actor, { contextIncludesProblem });

    if (
      contestResult &&
      contestResult.contest.allowedLanguages.length > 0 &&
      !contestResult.contest.allowedLanguages.includes(payload.language)
    ) {
      throw new ForbiddenError("Language not allowed in this contest");
    }

    if (
      courseContext?.assignment &&
      courseContext.assignment.allowedLanguages.length > 0 &&
      !courseContext.assignment.allowedLanguages.includes(payload.language)
    ) {
      throw new ForbiddenError("Language not allowed in this assignment");
    }

    if (problem.type === "multi_file") {
      const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problem.id);
      const entryPath = entryFileNameFor(payload.language);
      const hasEntry = workspaceFiles.some(
        (f) =>
          f.language === payload.language &&
          f.path === entryPath &&
          f.visibility === "editable",
      );
      if (!hasEntry) {
        throw new ForbiddenError(`No starter workspace available for ${payload.language}`);
      }
    }

    if (problem.type === "special_env" && problem.advancedRequiredPaths.length > 0) {
      const uploaded = (payload.sourceFiles ?? []).map((f) => f.path);
      const result = validateRequiredPaths(uploaded, problem.advancedRequiredPaths);
      if (!result.ok) {
        const missing = result.errors.map((e) => e.path).join(", ");
        throw new ConflictError(`Submission missing required paths: ${missing}`);
      }
    }

    void clientIp;

    if (contestResult && !payload.sampleOnly && contestResult.contest.submitCooldownSec > 0) {
      await checkSubmitCooldown(
        tx,
        contestResult.contest.id,
        user.id,
        problem.id,
        contestResult.contest.submitCooldownSec,
      );
    }

    if (courseContext?.assignment && !payload.sampleOnly) {
      const { maxAttemptsPerDay } = courseContext.assignment;

      if (maxAttemptsPerDay != null) {
        const now = new Date();
        const startOfDayUtc = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
        );

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`daily-attempt:${user.id}:${courseContext.assignment.id}:${startOfDayUtc.toISOString()}`}, 0))`;

        const todayCount = await submissionRepo
          .withTx(tx)
          .countForUserAndAssessmentSince(user.id, courseContext.assignment.id, startOfDayUtc);

        if (todayCount >= maxAttemptsPerDay) {
          throw new ConflictError("Daily submission limit reached. Please try again tomorrow.");
        }
      }
    }

    const sources = normalizeSubmissionSources(payload, problem, submissionId);

    const created = await submissionRepo.withTx(tx).create({
      id: submissionId,
      contestId: contestResult?.contest.id ?? null,
      contestParticipationId: contestParticipation?.id ?? null,
      virtualContestId: payload.virtualContestId ?? null,
      courseAssessmentId: courseContext?.assignment.id ?? null,
      examId: activeExamSession?.examId ?? null,
      courseId: courseContext?.course.id ?? null,
      language: payload.language,
      problemId: problem.id,
      sampleOnly: payload.sampleOnly ?? false,
      sourceStoragePrefix: submissionSourcePrefix(submissionId),
      status: "queued",
      userId: user.id,
    });

    return { row: created, sources };
  });

  try {
    await putSubmissionSources(storage(), submissionId, sources);
  } catch (err) {
    try {
      await deleteSubmissionStorage(storage(), submissionId);
    } catch {
      // Swallowed; orphan blobs at worst stay in the bucket until a sweep.
    }
    try {
      await submissionRepo.updateStatus(submissionId, "system_error");
    } catch {
      // Swallowed: prefer surfacing the original storage failure to the
      // caller. The row stays in `queued`; the blobs are already wiped.
    }
    throw err;
  }

  return row;
}

export async function updateSubmissionStatus(
  submissionId: string,
  status: string,
): Promise<void> {
  await submissionRepo.updateStatus(submissionId, status);
}

const SUMMARY_VERDICTS = new Set(["AC", "WA", "TLE", "MLE", "RE"]);

export function deriveVerdictSummary(result: SubmissionResult): VerdictSummary {
  const caseSummary = { ac: 0, wa: 0, tle: 0, mle: 0, re: 0, other: 0 };
  for (const c of result.caseResults ?? []) {
    const v = c.verdict.toUpperCase();
    if (SUMMARY_VERDICTS.has(v)) {
      if (v === "AC") caseSummary.ac += 1;
      else if (v === "WA") caseSummary.wa += 1;
      else if (v === "TLE") caseSummary.tle += 1;
      else if (v === "MLE") caseSummary.mle += 1;
      else if (v === "RE") caseSummary.re += 1;
    } else {
      caseSummary.other += 1;
    }
  }

  const summary: VerdictSummary = { caseSummary };

  if (result.subtaskResults && result.subtaskResults.length > 0) {
    summary.subtaskSummary = result.subtaskResults.map((s) => ({
      id: s.testcaseSetId,
      score: s.passed ? s.weight : 0,
    }));
  }

  if (result.verdict === "compile_error" && result.feedback) {
    summary.compilerErrorTruncated = result.feedback.slice(0, 1024);
  }

  return summary;
}

export async function completeJudge(
  submissionId: string,
  result: SubmissionResult,
): Promise<CompletedSubmission> {
  await putVerdictDetail(storage(), submissionId, result);

  const verdictSummary = deriveVerdictSummary(result);

  const submission = await submissionRepo.complete(submissionId, {
    runtimeMs: result.runtimeMs,
    ...(result.memoryKb !== undefined ? { memoryKb: result.memoryKb } : {}),
    score: result.score,
    status: result.verdict,
    verdictSummary: toJsonValue(verdictSummary),
    verdictDetailStorageKey: submissionVerdictDetailKey(submissionId),
  });

  return {
    contestParticipationId: submission.contestParticipationId,
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
): Promise<{ logId: string; oldStatus: string } | null> {
  const current = await submissionRepo.findById(submissionId);
  if (!current) return null;

  const oldDetail = current.verdictDetailStorageKey
    ? await storageGetVerdictDetail<unknown>(storage(), submissionId)
    : null;

  const row = await submissionRejudgeLogRepo.create({
    submissionId,
    rejudgedByUserId: triggeredByUserId,
    oldVerdict: current.status,
    oldScore: current.score,
    oldResultJson: oldDetail === null ? null : toJsonValue(oldDetail),
  });

  return { logId: row.id, oldStatus: current.status };
}

export async function finalizeRejudgeLog(
  submissionId: string,
  _triggeredByUserId: string | null,
  logId: string,
): Promise<void> {
  const updated = await submissionRepo.findById(submissionId);
  if (!updated) return;

  const newDetail = updated.verdictDetailStorageKey
    ? await storageGetVerdictDetail<unknown>(storage(), submissionId)
    : null;

  await submissionRejudgeLogRepo.update(logId, {
    newVerdict: updated.status,
    newScore: updated.score,
    newResultJson: newDetail === null ? null : toJsonValue(newDetail),
  });
}
