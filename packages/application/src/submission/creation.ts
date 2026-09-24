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
  submissionRepo,
  type SubmissionCreateContext,
  type TransactionClient,
} from "@nojv/db";
import {
  entryFileNameFor,
  validateRequiredPaths,
  type SubmissionDraft,
  type SubmissionJudgeJob,
} from "@nojv/core";
import { planSubmissionSources, putSubmissionSourcePlan } from "@nojv/storage";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import { toJsonValue } from "../shared/to-json-value";
import { prepareJudgeSnapshot } from "./judge-snapshot";
import { kickJudgeExecution } from "./judge-recovery";
import { createJudgeExecution } from "./judge-execution";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import { requireCourseAssignment, requireProblem, requireUser } from "../shared/require";
import { attemptWindowStart, DEFAULT_ATTEMPT_RESET_MINUTE } from "./attempt-window";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { checkExamSubmitCooldown } from "../exam/mutations";
import { assertCanSubmitToVirtualContest } from "../virtual-contest/queries";
import { assertProblemViewAccess, lockProblemForEdit } from "../problem/permissions";
import { checkProctoringGateInTx } from "../proctoring/gate";
import { normalizeSubmissionSources } from "./source-paths";
import { deriveSystemErrorVerdictSummary } from "./verdict-summary";

export type { ActorContext };

type SubmissionProblem = Awaited<ReturnType<typeof requireProblem>>;
type SubmissionCourseContext = Awaited<ReturnType<typeof requireCourseAssignment>>;
type SubmissionUser = Awaited<ReturnType<typeof requireUser>>;
type ActiveExamSession = NonNullable<
  Awaited<ReturnType<typeof examSessionRepo.findActiveForUser>>
>;
type SubmissionExam = NonNullable<Awaited<ReturnType<typeof examRepo.findById>>>;
type ContestSubmissionResult = Awaited<ReturnType<typeof ensureContestParticipation>>;

function buildSubmissionJudgeJob(
  payload: SubmissionDraft,
  submissionId: string,
): SubmissionJudgeJob {
  return {
    draft: {
      language: payload.language,
      problemId: payload.problemId,
      ...(payload.runCases ? { runCases: payload.runCases } : {}),
      ...(payload.sampleOnly !== undefined ? { sampleOnly: payload.sampleOnly } : {}),
    },
    submissionId,
  };
}

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
    if (receivedAt >= assignment.closesAt) {
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
  const judgeJob = buildSubmissionJudgeJob(payload, submissionId);

  await runTransaction(async (tx) => {
    if (payload.context.type === "exam") {
      const lockKey = `exam-session:${actor.userId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    }

    const isReferenceSolution = payload.referenceSolution === true;
    if (
      isReferenceSolution &&
      (payload.context.type !== "practice" || payload.sampleOnly === true)
    ) {
      throw new ConflictError("Reference solutions must use a full practice submission.");
    }
    const assignmentContext = payload.context.type === "assignment" ? payload.context : null;
    const problem = isReferenceSolution
      ? await lockProblemForEdit(tx, actor, payload.problemId)
      : await requireProblem(tx, payload.problemId);
    const [courseContext, user, activeExamSession] = await Promise.all([
      assignmentContext
        ? requireCourseAssignment(
            tx,
            assignmentContext.courseId,
            assignmentContext.assessmentId,
          )
        : null,
      requireUser(tx, actor.userId),
      examSessionRepo.withTx(tx).findActiveForUser(actor.userId),
    ]);

    if (isReferenceSolution && problem.type === "special_env") {
      throw new ConflictError(
        "Advanced-mode problems use their configured judge verification.",
      );
    }
    if (
      isReferenceSolution &&
      (await tx.testcase.count({ where: { testcaseSet: { problemId: problem.id } } })) === 0
    ) {
      throw new ConflictError(
        "Add at least one testcase before validating the reference solution.",
      );
    }

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
    if (!isReferenceSolution) {
      await assertProblemViewAccess(problem, actor, { contextIncludesProblem });
    }

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
      isReferenceSolution,
      problemId: problem.id,
      referenceProblemStorageGeneration: isReferenceSolution ? problem.storageGeneration : null,
      sampleOnly: payload.sampleOnly ?? false,
      sourceStorage: Prisma.DbNull,
      status: "pending_upload",
      userId: user.id,
    });
    if (isReferenceSolution) {
      await tx.problem.update({
        where: { id: problem.id },
        data: { referenceSolutionSubmissionId: null },
      });
    }
  });

  try {
    await guardStorageObjectWrites(sourcePlan.pointers);
    await putSubmissionSourcePlan(storage(), sourcePlan);
    const pinned = await prepareJudgeSnapshot(submissionId, judgeJob.draft, sources);

    return await runTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${payload.problemId} FOR UPDATE`;
      if (payload.referenceSolution === true) {
        await lockProblemForEdit(tx, actor, payload.problemId);
      }
      await commitStoragePointerSwap(tx, { added: sourcePlan.pointers });
      const submission = await submissionRepo
        .withTx(tx)
        .publishPendingUpload(submissionId, sourcePlan.manifest);
      await createJudgeExecution(tx, { submissionId, ...pinned });
      return submission;
    });
  } catch (uploadError) {
    try {
      await submissionRepo.completeIfInProgress(submissionId, {
        status: "system_error",
        verdictSummary: toJsonValue(
          deriveSystemErrorVerdictSummary(
            `Submission source upload failed: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`,
          ),
        ),
      });
    } catch (statusError) {
      throw new AggregateError(
        [uploadError, statusError],
        `Submission ${submissionId} upload failed and its intention could not be marked failed.`,
        { cause: statusError },
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
  void kickJudgeExecution(submission.id).catch(() => undefined);
  return submission;
}
