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
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { toJsonValue } from "../shared/to-json-value";
import { ensureUser } from "../user/mutations";
import { requireCourseAssignment, requireProblem } from "../shared/require";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { assertCanSubmitToVirtualContest } from "../virtual-contest/queries";
import { assertProblemViewAccess } from "../problem/permissions";
import type { CompletedSubmission } from "./types";

export type { ActorContext };

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string,
) {
  return runTransaction(async (tx) => {
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

    // Active-exam lockout: while a session is live, no foreign context (assignment,
    // contest, or virtual contest) can ride along. Bypass would skip exam cooldown,
    // IP binding, and per-day limits. Admins are exempt for operational recovery.
    if (activeExamSession && actor.platformRole !== "admin") {
      if (courseContext || payload.contestId || payload.virtualContestId) {
        throw new ForbiddenError(
          "You are in an active exam — submissions cannot carry an external assignment or contest context.",
        );
      }

      // Time-window enforcement. The session row stays active until the
      // auto-close workflow ends it, so without this an active session
      // would let a student keep submitting after `endsAt` (mirrors the
      // assignment `closesAt` check below). Authoritative — read fresh, so
      // it holds even if the auto-close timer is late or was never re-armed.
      const exam = await examRepo.withTx(tx).findById(activeExamSession.examId);
      if (exam && new Date() >= exam.endsAt) {
        throw new ForbiddenError("Exam has ended.");
      }
    }

    // Virtual contest gate. A virtual submission is practice-like — it sets no
    // contestId/examId/courseAssessmentId — but carries the `virtualContestId`
    // tag so the personal re-run can aggregate its own score on read. The gate
    // verifies the run is the actor's, the timer has not expired, and the
    // problem belongs to the replayed contest.
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

      // Published status + time window. Admins may submit outside the
      // window (operational review); course teachers/TAs currently flow
      // through the same path and should too.
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

      // Problem must actually be attached to this assignment — otherwise
      // a student could submit to an unrelated problem and have it
      // counted against this assignment's attempts/scoreboard.
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

    // Same "problem-in-context" check for contests: ensureContestParticipation
    // enforces time + published state, but does not verify the problem
    // belongs to the contest.
    if (contestResult) {
      const link = await tx.contestProblem.findFirst({
        where: { contestId: contestResult.contest.id, problemId: problem.id },
        select: { id: true },
      });
      if (!link) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
    }

    // Private-problem visibility: author, admin, or a viewer whose validated
    // context contains the problem. Without this, any private problem could be
    // submitted to by cuid. The async path also admits historical participants
    // (practice-after-close).
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

    // multi_file problems must have an editable main.<ext> for the chosen language.
    // full_source ships a single source file (system template); special_env has no workspace.
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

    // Pre-flight already runs in the browser, but the API can be called
    // directly. Re-validate the structural contract here as defense-in-depth.
    if (problem.type === "special_env" && problem.advancedRequiredPaths.length > 0) {
      const uploaded = (payload.sourceFiles ?? []).map((f) => f.path);
      const result = validateRequiredPaths(uploaded, problem.advancedRequiredPaths);
      if (!result.ok) {
        const missing = result.errors.map((e) => e.path).join(", ");
        throw new ConflictError(`Submission missing required paths: ${missing}`);
      }
    }

    // Exams own all IP gating; contest submissions no longer re-check.
    void clientIp;

    // Enforce submit cooldown for contest submissions (not sampleOnly runs)
    if (contestResult && !payload.sampleOnly && contestResult.contest.submitCooldownSec > 0) {
      await checkSubmitCooldown(
        tx,
        contestResult.contest.id,
        user.id,
        problem.id,
        contestResult.contest.submitCooldownSec,
      );
    }

    // UTC midnight boundary: 00:00:00 UTC counts toward the new day (gte start-of-day).
    if (courseContext?.assignment && !payload.sampleOnly) {
      const { maxAttemptsPerDay } = courseContext.assignment;

      if (maxAttemptsPerDay != null) {
        const now = new Date();
        const startOfDayUtc = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
        );

        const todayCount = await submissionRepo
          .withTx(tx)
          .countForUserAndAssessmentSince(user.id, courseContext.assignment.id, startOfDayUtc);

        if (todayCount >= maxAttemptsPerDay) {
          throw new ConflictError("Daily submission limit reached. Please try again tomorrow.");
        }
      }
    }

    return submissionRepo.withTx(tx).create({
      contestId: contestResult?.contest.id ?? null,
      contestParticipationId: contestParticipation?.id ?? null,
      // Virtual submissions sit outside the contest/exam/assignment xor —
      // practice-like, but tagged for the personal re-run scoreboard.
      virtualContestId: payload.virtualContestId ?? null,
      courseAssessmentId: courseContext?.assignment.id ?? null,
      // Active exam session is the source of truth for exam tagging:
      // the lockout above guarantees no foreign assignment/contest
      // payload sneaks past, so writing examId from the session here
      // gives downstream scoring/cooldown a reliable join key without
      // trusting the client.
      examId: activeExamSession?.examId ?? null,
      courseId: courseContext?.course.id ?? null,
      language: payload.language,
      problemId: problem.id,
      sampleOnly: payload.sampleOnly ?? false,
      sourceCode: payload.sourceCode,
      status: "queued",
      userId: user.id,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Verdict writes
// ─────────────────────────────────────────────────────────────────────────

export async function updateSubmissionStatus(
  submissionId: string,
  status: string,
): Promise<void> {
  await submissionRepo.updateStatus(submissionId, status);
}

export async function completeJudge(
  submissionId: string,
  result: SubmissionResult,
): Promise<CompletedSubmission> {
  const submission = await submissionRepo.complete(submissionId, {
    runtimeMs: result.runtimeMs,
    ...(result.memoryKb !== undefined ? { memoryKb: result.memoryKb } : {}),
    score: result.score,
    status: result.verdict,
    verdictDetail: toJsonValue(result),
  });

  return {
    contestParticipationId: submission.contestParticipationId,
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

// ─────────────────────────────────────────────────────────────────────────
// Rejudge audit log
//
// Two-pass audit for rejudges.
//
// `snapshotForRejudge` writes a log row with the pre-rejudge state
// before the sandbox runs; `finalizeRejudgeLog` fills in the post-
// rejudge fields after `completeJudge` writes the new verdict.
//
// The two passes are deliberately separate: the snapshot must see the
// pre-rejudge row, and `completeJudge` overwrites it in place.
// new* columns are nullable so the snapshot is a valid standalone
// row if the workflow dies between the two calls (Temporal retries
// land on the already-snapshotted row rather than duplicating).
// ─────────────────────────────────────────────────────────────────────────

export async function snapshotForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
): Promise<{ logId: string; oldStatus: string } | null> {
  const current = await submissionRepo.findById(submissionId);
  if (!current) return null;

  const row = await submissionRejudgeLogRepo.create({
    submissionId,
    rejudgedByUserId: triggeredByUserId,
    oldVerdict: current.status,
    oldScore: current.score,
    oldResultJson: current.verdictDetail === null ? null : toJsonValue(current.verdictDetail),
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

  await submissionRejudgeLogRepo.update(logId, {
    newVerdict: updated.status,
    newScore: updated.score,
    newResultJson: updated.verdictDetail === null ? null : toJsonValue(updated.verdictDetail),
  });
}
