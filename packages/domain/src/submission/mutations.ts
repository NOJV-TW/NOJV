import {
  courseMembershipRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRepo
} from "@nojv/db";
import { entryFileNameFor, type SubmissionDraft } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError } from "../shared/errors";
import { checkIpLock } from "../shared/ip-utils";
import { ensureUser } from "../user/mutations";
import { requireProblem } from "../problem/mutations";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { requireCourseAssessment } from "../course/mutations";

export type { ActorContext };

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string
) {
  return runTransaction(async (tx) => {
    // The problem lookup, the (optional) course-assessment lookup, and
    // the user upsert are independent — each only needs tx + params.
    // Run them in parallel to cut two round-trips off the submission
    // hot path. Concurrent queries inside a Prisma interactive
    // transaction are supported here (see contest/course mutations
    // for other examples).
    const [problem, courseContext, user] = await Promise.all([
      requireProblem(tx, payload.problemId),
      payload.assessment
        ? requireCourseAssessment(
            tx,
            payload.assessment.courseSlug,
            payload.assessment.assessmentSlug
          )
        : null,
      ensureUser(tx, actor.userId, actor)
    ]);

    // ── Authorization: verify user is enrolled in the course ──
    if (courseContext) {
      const membership = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(courseContext.course.id, actor.userId);

      if (membership?.status !== "active") {
        throw new ForbiddenError("You are not enrolled in this course.");
      }
    }

    const contestResult = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug, {
          problemId: problem.id,
          sampleOnly: payload.sampleOnly ?? false
        })
      : null;
    const contestParticipation = contestResult?.participation ?? null;

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

    // ── IP lock recheck (contests only — assessments no longer have IP lock) ──
    if (contestResult && contestParticipation) {
      const { contest } = contestResult;
      if (contest.ipWhitelistEnabled || contest.ipBindingEnabled) {
        const ipResult = await checkIpLock(
          tx,
          contest,
          clientIp,
          { id: contestParticipation.id, boundIp: contestParticipation.boundIp },
          { userId: user.id, contestId: contest.id }
        );
        if (!ipResult.allowed) {
          throw new ForbiddenError("IP address not allowed for this contest");
        }
      }
    }

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

    // Enforce attempt limit for assignment submissions (not sampleOnly runs)
    if (courseContext?.assessment && !payload.sampleOnly) {
      const { maxAttempts } = courseContext.assessment;

      if (maxAttempts != null) {
        const attemptCount = await submissionRepo.withTx(tx).count({
          courseAssessmentId: courseContext.assessment.id,
          problemId: problem.id,
          sampleOnly: false,
          userId: user.id
        });

        if (attemptCount >= maxAttempts) {
          throw new ConflictError(
            `Attempt limit reached (${String(maxAttempts)}/${String(maxAttempts)}).`
          );
        }
      }
    }

    return submissionRepo.withTx(tx).create({
      contestId: contestResult?.contest.id ?? null,
      contestParticipationId: contestParticipation?.id ?? null,
      courseAssessmentId: courseContext?.assessment.id ?? null,
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
