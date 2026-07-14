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
  type SubmissionCreateContext,
  type TransactionClient,
} from "@nojv/db";
import {
  entryFileNameFor,
  validateRequiredPaths,
  type AdvancedJudgeVerificationSnapshot,
  type SubmissionDraft,
  type SubmissionJudgeDraft,
  type SubmissionOperationStatus,
  type SubmissionResult,
  type VerdictSummary,
} from "@nojv/core";
import {
  planSubmissionSources,
  putImmutableObject,
  putSubmissionSourcePlan,
  assertStorageObjectPointer,
  storagePointerFor,
  submissionVerdictDetailKey,
} from "@nojv/storage";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { toJsonValue } from "../shared/to-json-value";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import { ensureUser } from "../user/mutations";
import { requireCourseAssignment, requireProblem } from "../shared/require";
import { attemptWindowStart, DEFAULT_ATTEMPT_RESET_MINUTE } from "./attempt-window";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { checkExamSubmitCooldown } from "../exam/mutations";
import { assertCanSubmitToVirtualContest } from "../virtual-contest/queries";
import { assertProblemViewAccess } from "../problem/permissions";
import { checkProctoringGateInTx } from "../proctoring/gate";
import { normalizeSubmissionSources } from "./source-paths";
import { enqueueSubmissionJudgeDispatch } from "./rejudge-control";
import type { CompletedSubmission } from "./types";

export type { ActorContext };

type SubmissionStatus = SubmissionOperationStatus;

type SubmissionProblem = Awaited<ReturnType<typeof requireProblem>>;
type SubmissionCourseContext = Awaited<ReturnType<typeof requireCourseAssignment>>;
type SubmissionUser = Awaited<ReturnType<typeof ensureUser>>;
type ActiveExamSession = NonNullable<
  Awaited<ReturnType<typeof examSessionRepo.findActiveForUser>>
>;
type SubmissionExam = NonNullable<Awaited<ReturnType<typeof examRepo.findById>>>;
type ContestSubmissionResult = Awaited<ReturnType<typeof ensureContestParticipation>>;

async function assertActiveExamSubmissionAllowed(
  tx: TransactionClient,
  ctx: {
    activeExamSession: ActiveExamSession;
    clientIp: string;
    payload: SubmissionDraft;
    problem: SubmissionProblem;
    receivedAt: Date;
    user: SubmissionUser;
  },
): Promise<SubmissionExam> {
  const { activeExamSession, clientIp, payload, problem, receivedAt, user } = ctx;

  const exam = await examRepo.withTx(tx).findById(activeExamSession.examId);
  if (exam?.status !== "published") {
    throw new NotFoundError("Exam not found.");
  }
  if (receivedAt >= exam.endsAt) {
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

  if (!payload.sampleOnly && exam.submitCooldownSec > 0) {
    await checkExamSubmitCooldown(
      tx,
      exam.id,
      user.id,
      problem.id,
      exam.submitCooldownSec,
      receivedAt,
    );
  }

  return exam;
}

async function assertCourseSubmissionAllowed(
  tx: TransactionClient,
  ctx: {
    actor: ActorContext;
    courseContext: SubmissionCourseContext;
    problem: SubmissionProblem;
    receivedAt: Date;
  },
): Promise<void> {
  const { actor, courseContext, problem, receivedAt } = ctx;
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
    if (receivedAt < assignment.opensAt) {
      throw new ForbiddenError("Assignment has not opened yet.");
    }
    if (receivedAt > assignment.closesAt) {
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
  problem: SubmissionProblem,
  contestResult: ContestSubmissionResult | null,
  courseContext: SubmissionCourseContext | null,
  exam: SubmissionExam | null,
): void {
  if (problem.type === "special_env") return;
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

  if (
    exam &&
    exam.allowedLanguages.length > 0 &&
    !exam.allowedLanguages.includes(payload.language)
  ) {
    throw new ForbiddenError("Language not allowed in this exam");
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
  receivedAt: Date,
): Promise<void> {
  const { maxAttemptsPerDay, attemptResetMinuteOfDay } = courseContext.assignment;

  if (maxAttemptsPerDay != null) {
    const windowStart = attemptWindowStart(
      attemptResetMinuteOfDay ?? DEFAULT_ATTEMPT_RESET_MINUTE,
      receivedAt,
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
  const receivedAt = new Date();
  const submissionId = randomUUID();
  const sourceGeneration = randomUUID();
  const sources = normalizeSubmissionSources(payload);
  const sourcePlan = planSubmissionSources(submissionId, sourceGeneration, sources);
  const judgeDraft: SubmissionJudgeDraft = {
    language: payload.language,
    problemId: payload.problemId,
    ...(payload.runCases ? { runCases: payload.runCases } : {}),
    ...(payload.sampleOnly !== undefined ? { sampleOnly: payload.sampleOnly } : {}),
  };

  await runTransaction(async (tx) => {
    const assignmentContext = payload.context.type === "assignment" ? payload.context : null;
    const [problem, courseContext, user, activeExamSession] = await Promise.all([
      requireProblem(tx, payload.problemId),
      assignmentContext
        ? requireCourseAssignment(
            tx,
            assignmentContext.courseId,
            assignmentContext.assessmentId,
          )
        : null,
      ensureUser(tx, actor.userId, actor),
      examSessionRepo.withTx(tx).findActiveForUser(actor.userId),
    ]);

    if (
      activeExamSession &&
      actor.platformRole !== "admin" &&
      (payload.context.type !== "exam" || payload.context.examId !== activeExamSession.examId)
    ) {
      throw new ForbiddenError(
        "You are in an active exam — submissions must use that exam context.",
      );
    }

    let exam: SubmissionExam | null = null;
    if (payload.context.type === "exam") {
      if (activeExamSession?.examId !== payload.context.examId) {
        throw new ForbiddenError("An active session for this exam is required.");
      }
      exam = await assertActiveExamSubmissionAllowed(tx, {
        activeExamSession,
        clientIp,
        payload,
        problem,
        receivedAt,
        user,
      });
    }

    if (payload.context.type === "virtual") {
      await assertCanSubmitToVirtualContest(
        payload.context.participationId,
        actor.userId,
        problem.id,
        receivedAt,
      );
    }

    if (courseContext) {
      await assertCourseSubmissionAllowed(tx, { actor, courseContext, problem, receivedAt });
    }

    const contestResult =
      payload.context.type === "contest"
        ? await ensureContestParticipation(
            tx,
            user.id,
            payload.context.contestId,
            actor.platformRole,
            receivedAt,
          )
        : null;

    if (contestResult) {
      const link = await contestProblemRepo
        .withTx(tx)
        .findLink(contestResult.contest.id, problem.id);
      if (!link) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
    }

    const contextIncludesProblem = payload.context.type !== "practice";
    await assertProblemViewAccess(problem, actor, { contextIncludesProblem });

    assertLanguageAllowed(payload, problem, contestResult, courseContext, exam);

    await assertSubmissionFilesValid(payload, problem);

    if (contestResult && !payload.sampleOnly && contestResult.contest.submitCooldownSec > 0) {
      await checkSubmitCooldown(
        tx,
        contestResult.contest.id,
        user.id,
        problem.id,
        contestResult.contest.submitCooldownSec,
        receivedAt,
      );
    }

    if (courseContext?.assignment && !payload.sampleOnly) {
      await assertDailyAttemptLimit(tx, courseContext, user, problem.id, receivedAt);
    }

    let submissionContext: SubmissionCreateContext;
    switch (payload.context.type) {
      case "assignment":
        if (!courseContext) throw new NotFoundError("Assignment not found.");
        submissionContext = {
          type: "assignment",
          assessmentId: courseContext.assignment.id,
          courseId: courseContext.course.id,
        };
        break;
      case "exam":
        if (!exam) throw new NotFoundError("Exam not found.");
        submissionContext = { type: "exam", examId: exam.id };
        break;
      case "contest":
        if (!contestResult) throw new NotFoundError("Contest not found.");
        submissionContext = { type: "contest", contestId: contestResult.contest.id };
        break;
      case "virtual":
        submissionContext = {
          type: "virtual",
          participationId: payload.context.participationId,
        };
        break;
      default:
        submissionContext = { type: "practice" };
    }

    await submissionRepo.withTx(tx).create({
      id: submissionId,
      context: submissionContext,
      createdAt: receivedAt,
      ipAddress: clientIp,
      language: payload.language,
      problemId: problem.id,
      sampleOnly: payload.sampleOnly ?? false,
      sourceStorage: Prisma.DbNull,
      status: "pending_upload",
      userId: user.id,
    });
  });

  try {
    await guardStorageObjectWrites(sourcePlan.pointers);
    await putSubmissionSourcePlan(storage(), sourcePlan);

    return await runTransaction(async (tx) => {
      await commitStoragePointerSwap(tx, { added: sourcePlan.pointers });
      const submission = await submissionRepo
        .withTx(tx)
        .publishPendingUpload(submissionId, sourcePlan.manifest);
      await enqueueSubmissionJudgeDispatch(tx, {
        draft: judgeDraft,
        submissionId: submission.id,
      });
      return submission;
    });
  } catch (uploadError) {
    try {
      await submissionRepo.updateStatusIfIn(submissionId, ["pending_upload"], "system_error");
    } catch (statusError) {
      throw new AggregateError(
        [uploadError, statusError],
        `Submission ${submissionId} upload failed and its intention could not be marked failed.`,
      );
    }
    throw uploadError;
  }
}

export async function submitAndDispatch(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string,
) {
  const submission = await createQueuedSubmissionRecord(payload, actor, clientIp);

  return submission;
}

export async function startSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const submission = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!submission) throw new NotFoundError(`Submission ${submissionId} not found`);
    if (submission.activeJudgeRunId === judgeRunId) return;
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
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (
      current?.activeJudgeRunId !== judgeRunId ||
      !["queued", "compiling", "running"].includes(current.status)
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
): Promise<{ logId: string; oldStatus: string } | null> {
  return runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!current) return null;
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
