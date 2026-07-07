import { randomUUID } from "node:crypto";

import {
  assessmentProblemRepo,
  contestProblemRepo,
  courseMembershipRepo,
  examProblemRepo,
  examRepo,
  examSessionRepo,
  Prisma,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRejudgeLogRepo,
  submissionRepo,
  type TransactionClient,
} from "@nojv/db";
import {
  entryFileNameFor,
  validateRequiredPaths,
  type AdvancedConfig,
  type SubmissionDraft,
  type SubmissionOperationStatus,
  type SubmissionResult,
  type VerdictSummary,
} from "@nojv/core";
import {
  deleteSubmissionStorage,
  promoteSubmissionSources,
  putSubmissionSourcesStaged,
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
import { attemptWindowStart, DEFAULT_ATTEMPT_RESET_MINUTE } from "./attempt-window";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { checkExamSubmitCooldown } from "../exam/mutations";
import { assertCanSubmitToVirtualContest } from "../virtual-contest/queries";
import { assertProblemViewAccess } from "../problem/permissions";
import { checkProctoringGateInTx } from "../proctoring/gate";
import { normalizeSubmissionSources } from "./source-paths";
import { dispatchSubmissionJudge } from "./rejudge-control";
import type { CompletedSubmission } from "./types";

export type { ActorContext };

type SubmissionStatus = SubmissionOperationStatus;

type SubmissionProblem = Awaited<ReturnType<typeof requireProblem>>;
type SubmissionCourseContext = Awaited<ReturnType<typeof requireCourseAssignment>>;
type SubmissionUser = Awaited<ReturnType<typeof ensureUser>>;
type ActiveExamSession = NonNullable<
  Awaited<ReturnType<typeof examSessionRepo.findActiveForUser>>
>;
type ContestSubmissionResult = Awaited<ReturnType<typeof ensureContestParticipation>>;

async function assertActiveExamSubmissionAllowed(
  tx: TransactionClient,
  ctx: {
    activeExamSession: ActiveExamSession;
    clientIp: string;
    courseContext: SubmissionCourseContext | null;
    payload: SubmissionDraft;
    problem: SubmissionProblem;
    user: SubmissionUser;
  },
): Promise<void> {
  const { activeExamSession, clientIp, courseContext, payload, problem, user } = ctx;
  if (courseContext || payload.contestId || payload.participationId) {
    throw new ForbiddenError(
      "You are in an active exam — submissions cannot carry an external assignment or contest context.",
    );
  }

  const exam = await examRepo.withTx(tx).findById(activeExamSession.examId);
  if (exam && new Date() >= exam.endsAt) {
    throw new ForbiddenError("Exam has ended.");
  }

  const inExam = await examProblemRepo.withTx(tx).exists(activeExamSession.examId, problem.id);
  if (!inExam) {
    throw new ForbiddenError("This problem is not part of the exam.");
  }

  const gate = await checkProctoringGateInTx(tx, {
    entityKind: "exam",
    entityId: activeExamSession.examId,
    userId: user.id,
    ip: clientIp,
  });
  if (!gate.ok && (gate.reason === "ip_binding" || gate.reason === "ip_whitelist")) {
    throw new ForbiddenError(
      "Submission blocked: your network does not match the exam's IP restrictions.",
    );
  }

  if (exam && !payload.sampleOnly && exam.submitCooldownSec > 0) {
    await checkExamSubmitCooldown(tx, exam.id, user.id, problem.id, exam.submitCooldownSec);
  }
}

async function assertCourseSubmissionAllowed(
  tx: TransactionClient,
  ctx: {
    actor: ActorContext;
    courseContext: SubmissionCourseContext;
    problem: SubmissionProblem;
  },
): Promise<void> {
  const { actor, courseContext, problem } = ctx;
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

  const link = await assessmentProblemRepo.withTx(tx).findLink(assignment.id, problem.id);
  if (!link) {
    throw new ForbiddenError("This problem is not part of the assignment.");
  }
}

function assertLanguageAllowed(
  payload: SubmissionDraft,
  contestResult: ContestSubmissionResult | null,
  courseContext: SubmissionCourseContext | null,
): void {
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
}

async function assertSubmissionFilesValid(
  payload: SubmissionDraft,
  problem: SubmissionProblem,
): Promise<void> {
  if (problem.type === "multi_file") {
    const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problem.id);
    const entryPath = entryFileNameFor(payload.language);
    const hasEntry = workspaceFiles.some(
      (f) =>
        f.language === payload.language && f.path === entryPath && f.visibility === "editable",
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
}

async function assertDailyAttemptLimit(
  tx: TransactionClient,
  courseContext: SubmissionCourseContext,
  user: SubmissionUser,
  problemId: string,
): Promise<void> {
  const { maxAttemptsPerDay, attemptResetMinuteOfDay } = courseContext.assignment;

  if (maxAttemptsPerDay != null) {
    const windowStart = attemptWindowStart(
      attemptResetMinuteOfDay ?? DEFAULT_ATTEMPT_RESET_MINUTE,
      new Date(),
    );

    const lockKey = `daily-attempt:${user.id}:${courseContext.assignment.id}:${problemId}:${windowStart.toISOString()}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const windowCount = await submissionRepo
      .withTx(tx)
      .countForUserAssessmentProblemSince(
        user.id,
        courseContext.assignment.id,
        problemId,
        windowStart,
      );

    if (windowCount >= maxAttemptsPerDay) {
      throw new ConflictError("Daily submission limit reached. Please try again tomorrow.");
    }
  }
}

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string,
) {
  const submissionId = randomUUID();

  const { sources } = await runTransaction(async (tx) => {
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
      await assertActiveExamSubmissionAllowed(tx, {
        activeExamSession,
        clientIp,
        courseContext,
        payload,
        problem,
        user,
      });
    }

    if (payload.participationId) {
      if (courseContext || payload.contestId) {
        throw new ForbiddenError(
          "A virtual-contest submission cannot also carry a contest or assignment context.",
        );
      }
      await assertCanSubmitToVirtualContest(payload.participationId, actor.userId, problem.id);
    }

    if (courseContext) {
      await assertCourseSubmissionAllowed(tx, { actor, courseContext, problem });
    }

    const contestResult = payload.contestId
      ? await ensureContestParticipation(tx, user.id, payload.contestId, actor.platformRole)
      : null;

    if (contestResult) {
      const link = await contestProblemRepo
        .withTx(tx)
        .findLink(contestResult.contest.id, problem.id);
      if (!link) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
    }

    const contextIncludesProblem = Boolean(courseContext) || Boolean(contestResult);
    await assertProblemViewAccess(problem, actor, { contextIncludesProblem });

    assertLanguageAllowed(payload, contestResult, courseContext);

    await assertSubmissionFilesValid(payload, problem);

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
      await assertDailyAttemptLimit(tx, courseContext, user, problem.id);
    }

    const sources = normalizeSubmissionSources(payload, submissionId);

    const created = await submissionRepo.withTx(tx).create({
      id: submissionId,
      contestId: contestResult?.contest.id ?? null,
      participationId: payload.participationId ?? null,
      assessmentId: courseContext?.assignment.id ?? null,
      examId: activeExamSession?.examId ?? null,
      courseId: courseContext?.course.id ?? null,
      ipAddress: clientIp,
      language: payload.language,
      problemId: problem.id,
      sampleOnly: payload.sampleOnly ?? false,
      sourceStoragePrefix: submissionSourcePrefix(submissionId),
      status: "pending_upload",
      userId: user.id,
    });

    return { row: created, sources };
  });

  const storageClient = storage();
  try {
    await putSubmissionSourcesStaged(storageClient, submissionId, sources);
    await promoteSubmissionSources(storageClient, submissionId, sources);
  } catch (err) {
    await deleteSubmissionStorage(storageClient, submissionId).catch(() => undefined);
    await submissionRepo.updateStatus(submissionId, "system_error").catch(() => undefined);
    throw err;
  }

  return submissionRepo.updateStatus(submissionId, "queued").catch(async (err: unknown) => {
    await deleteSubmissionStorage(storageClient, submissionId).catch(() => undefined);
    await submissionRepo.updateStatus(submissionId, "system_error").catch(() => undefined);
    throw err;
  });
}

export async function submitAndDispatch(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string,
) {
  const submission = await createQueuedSubmissionRecord(payload, actor, clientIp);

  const judgeDraft: SubmissionDraft = { ...payload };
  delete judgeDraft.sourceCode;
  delete judgeDraft.sourceFiles;

  try {
    await dispatchSubmissionJudge({ draft: judgeDraft, submissionId: submission.id });
  } catch (err) {
    await submissionRepo.updateStatus(submission.id, "system_error").catch(() => undefined);
    throw err;
  }

  return submission;
}

export async function updateSubmissionStatus(
  submissionId: string,
  status: SubmissionStatus,
): Promise<void> {
  await submissionRepo.updateStatus(submissionId, status);
}

export async function restoreSubmissionAfterCancelledRejudge(
  submissionId: string,
  oldStatus: string,
): Promise<void> {
  await submissionRepo.updateStatusIfIn(submissionId, ["queued", "running"], oldStatus);
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
      score: s.rawScore ?? (s.passed ? s.weight : 0),
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
  advancedConfigSnapshot: AdvancedConfig | null = null,
): Promise<CompletedSubmission | null> {
  await putVerdictDetail(storage(), submissionId, result);

  const verdictSummary = deriveVerdictSummary(result);

  const { count } = await submissionRepo.completeIfInProgress(submissionId, {
    runtimeMs: result.runtimeMs,
    ...(result.memoryKb !== undefined ? { memoryKb: result.memoryKb } : {}),
    score: result.score,
    status: result.verdict,
    verdictSummary: toJsonValue(verdictSummary),
    verdictDetailStorageKey: submissionVerdictDetailKey(submissionId),
    advancedConfigSnapshot:
      advancedConfigSnapshot === null ? Prisma.JsonNull : toJsonValue(advancedConfigSnapshot),
  });

  if (count === 0) return null;

  const submission = await submissionRepo.findById(submissionId);
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
  rejudgeRunId: string | null,
): Promise<{ logId: string; oldStatus: string } | null> {
  const current = await submissionRepo.findById(submissionId);
  if (!current) return null;

  const row = await submissionRejudgeLogRepo.upsertSnapshot({
    submissionId,
    rejudgedByUserId: triggeredByUserId,
    rejudgeRunId,
    oldVerdict: current.status,
    oldScore: current.score,
    oldResultJson: current.verdictSummary === null ? null : toJsonValue(current.verdictSummary),
  });

  await submissionRepo.updateStatus(submissionId, "running");

  return { logId: row.id, oldStatus: row.oldVerdict };
}

export async function finalizeRejudgeLog(
  submissionId: string,
  _triggeredByUserId: string | null,
  logId: string,
): Promise<void> {
  const updated = await submissionRepo.findById(submissionId);
  if (!updated) return;

  await submissionRejudgeLogRepo.update(logId, {
    newVerdict: updated.status,
    newScore: updated.score,
    newResultJson: updated.verdictSummary === null ? null : toJsonValue(updated.verdictSummary),
  });
}
