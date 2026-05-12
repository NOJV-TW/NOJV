import {
  courseMembershipRepo,
  examSessionRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRepo,
} from "@nojv/db";
import { entryFileNameFor, validateRequiredPaths, type SubmissionDraft } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { ensureUser } from "../user/mutations";
import { requireCourseAssessment, requireProblem } from "../shared/require";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { assertProblemViewAccess } from "../problem/helpers";

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
        ? requireCourseAssessment(
            tx,
            payload.assessment.courseId,
            payload.assessment.assessmentId,
          )
        : null,
      ensureUser(tx, actor.userId, actor),
      examSessionRepo.withTx(tx).findActiveForUser(actor.userId),
    ]);

    // Active-exam lockout: while a session is live, no foreign context (assessment
    // or contest) can ride along. Bypass would skip exam cooldown, IP binding,
    // and per-day limits. Admins are exempt for operational recovery.
    if (activeExamSession && actor.platformRole !== "admin") {
      if (courseContext || payload.contestId) {
        throw new ForbiddenError(
          "You are in an active exam — submissions cannot carry an external assessment or contest context.",
        );
      }
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
      const assessment = courseContext.assessment;
      if (assessment.status !== "published") {
        throw new NotFoundError("Assessment not found.");
      }
      if (actor.platformRole !== "admin" && membership.role === "student") {
        const now = new Date();
        if (now < assessment.opensAt) {
          throw new ForbiddenError("Assignment has not opened yet.");
        }
        if (now > assessment.closesAt) {
          throw new ForbiddenError("Assignment has ended.");
        }
      }

      // Problem must actually be attached to this assessment — otherwise
      // a student could submit to an unrelated problem and have it
      // counted against this assignment's attempts/scoreboard.
      const link = await tx.courseAssessmentProblem.findFirst({
        where: { assessmentId: assessment.id, problemId: problem.id },
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
      courseContext?.assessment &&
      courseContext.assessment.allowedLanguages.length > 0 &&
      !courseContext.assessment.allowedLanguages.includes(payload.language)
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
    if (courseContext?.assessment && !payload.sampleOnly) {
      const { maxAttemptsPerDay } = courseContext.assessment;

      if (maxAttemptsPerDay != null) {
        const now = new Date();
        const startOfDayUtc = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
        );

        const todayCount = await submissionRepo
          .withTx(tx)
          .countForUserAndAssessmentSince(user.id, courseContext.assessment.id, startOfDayUtc);

        if (todayCount >= maxAttemptsPerDay) {
          throw new ConflictError("Daily submission limit reached. Please try again tomorrow.");
        }
      }
    }

    return submissionRepo.withTx(tx).create({
      contestId: contestResult?.contest.id ?? null,
      contestParticipationId: contestParticipation?.id ?? null,
      courseAssessmentId: courseContext?.assessment.id ?? null,
      // Active exam session is the source of truth for exam tagging:
      // the lockout above guarantees no foreign assessment/contest
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
