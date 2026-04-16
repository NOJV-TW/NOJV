import {
  courseMembershipRepo,
  examSessionRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRepo
} from "@nojv/db";
import { entryFileNameFor, type SubmissionDraft } from "@nojv/core";

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
  clientIp: string
) {
  return runTransaction(async (tx) => {
    const [problem, courseContext, user, activeExamSession] = await Promise.all([
      requireProblem(tx, payload.problemId),
      payload.assessment
        ? requireCourseAssessment(
            tx,
            payload.assessment.courseId,
            payload.assessment.assessmentSlug
          )
        : null,
      ensureUser(tx, actor.userId, actor),
      examSessionRepo.withTx(tx).findActiveForUser(actor.userId)
    ]);

    // ── Active exam lockout: forbid piping a submission through any
    // foreign context while an exam session is live. The exam endpoint
    // attaches examId via the dedicated flow; letting clients pass an
    // assessment/contest slug here would bypass exam cooldown, IP binding,
    // and per-day limits. Admins are exempt for operational recovery.
    if (activeExamSession && actor.platformRole !== "admin") {
      if (courseContext || payload.contestSlug) {
        throw new ForbiddenError(
          "You are in an active exam — submissions cannot carry an external assessment or contest context."
        );
      }
    }

    // ── Authorization: verify user is enrolled in the course ──
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
        select: { id: true }
      });
      if (!link) {
        throw new ForbiddenError("This problem is not part of the assignment.");
      }
    }

    const contestResult = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug, {
          problemId: problem.id,
          sampleOnly: payload.sampleOnly ?? false
        })
      : null;
    const contestParticipation = contestResult?.participation ?? null;

    // Same "problem-in-context" check for contests: ensureContestParticipation
    // enforces time + published state, but does not verify the problem
    // belongs to the contest.
    if (contestResult) {
      const link = await tx.contestProblem.findFirst({
        where: { contestId: contestResult.contest.id, problemId: problem.id },
        select: { id: true }
      });
      if (!link) {
        throw new ForbiddenError("This problem is not part of the contest.");
      }
    }

    // ── Visibility: a private problem is only submittable by its author,
    // admins, or a viewer whose (already-validated) context contains it.
    // Without this, a user could submit to any private problem by cuid.
    // The async path also admits historical participants (practice-after-close). ──
    const contextIncludesProblem = Boolean(courseContext) || Boolean(contestResult);
    await assertProblemViewAccess(problem, actor, { contextIncludesProblem });

    // ── Language restriction: contest ──
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

    // special_env problems ship no workspace; other types must have an editable main.<ext>.
    if (problem.type !== "special_env") {
      const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problem.id);
      // full_source problems with no workspace files submit a single source file directly.
      if (workspaceFiles.length > 0 || problem.type !== "full_source") {
        const entryPath = entryFileNameFor(payload.language);
        const hasEntry = workspaceFiles.some(
          (f) =>
            f.language === payload.language &&
            f.path === entryPath &&
            f.visibility === "editable"
        );
        if (!hasEntry) {
          throw new ForbiddenError(`No starter workspace available for ${payload.language}`);
        }
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
        contestResult.contest.submitCooldownSec
      );
    }

    // UTC midnight boundary: 00:00:00 UTC counts toward the new day (gte start-of-day).
    if (courseContext?.assessment && !payload.sampleOnly) {
      const { maxAttemptsPerDay } = courseContext.assessment;

      if (maxAttemptsPerDay != null) {
        const now = new Date();
        const startOfDayUtc = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
        );

        const todayCount = await submissionRepo
          .withTx(tx)
          .countForUserAndAssessmentSince(user.id, courseContext.assessment.id, startOfDayUtc);

        if (todayCount >= maxAttemptsPerDay) {
          throw new ConflictError("每日提交次數已達上限，請明天再試");
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
      userId: user.id
    });
  });
}
