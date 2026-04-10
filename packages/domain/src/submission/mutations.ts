import {
  assessmentParticipationRepo,
  courseMembershipRepo,
  problemWorkspaceFileRepo,
  runTransaction,
  submissionRepo
} from "@nojv/db";
import type { SubmissionDraft } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError } from "../shared/errors";
import { checkIpLock } from "../shared/ip-utils";
import { ensureUser } from "../user/mutations";
import { requireProblem } from "../problem/mutations";
import { ensureContestParticipation, checkSubmitCooldown } from "../contest/mutations";
import { requireCourseAssessment } from "../course/mutations";

export type { ActorContext };

// ─── Submission creation ────────────────────────────────────────────

/**
 * Validate constraints and create a queued submission record inside a transaction.
 *
 * @param payload  - The submission draft from the client.
 * @param actor    - The authenticated user context (no SvelteKit dependency).
 * @param clientIp - The pre-extracted client IP address (caller is responsible for extraction).
 */
export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: ActorContext,
  clientIp: string
) {
  return runTransaction(async (tx) => {
    const problem = await requireProblem(tx, payload.problemId);
    const courseContext = payload.assessment
      ? await requireCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
      : null;

    // ── Authorization: verify user is enrolled in the course ──
    if (courseContext) {
      const membership = await courseMembershipRepo
        .withTx(tx)
        .findByComposite(courseContext.course.id, actor.userId);

      if (membership?.status !== "active") {
        throw new ForbiddenError("You are not enrolled in this course.");
      }
    }

    // ── Derive mode from server context, ignore client-provided mode ──
    const mode = payload.contestSlug ? "contest" : courseContext ? "assignment" : "practice";

    const user = await ensureUser(tx, actor.userId, actor);
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

    // ── Language restriction: assignment ──
    if (
      courseContext?.assessment &&
      courseContext.assessment.allowedLanguages.length > 0 &&
      !courseContext.assessment.allowedLanguages.includes(payload.language)
    ) {
      throw new ForbiddenError("Language not allowed in this assignment");
    }

    // ── Language restriction: verify starter workspace exists ──
    // After the Phase 5 cleanup this check uses ProblemWorkspaceFile
    // (the unified starter-code + teacher-asset model) instead of the
    // old ProblemTemplate table.
    if (problem.submissionType === "function") {
      const workspaceFiles = await problemWorkspaceFileRepo.findByProblemId(problem.id);
      const hasLanguageWorkspace = workspaceFiles.some((f) => f.language === payload.language);
      if (!hasLanguageWorkspace) {
        throw new ForbiddenError("No starter workspace available for this language");
      }
    }

    // ── IP lock recheck ──
    if (contestResult && contestParticipation) {
      const { contest } = contestResult;
      if (contest.ipWhitelistEnabled || contest.ipBindingEnabled) {
        const ipResult = await checkIpLock(
          tx,
          contest,
          clientIp,
          { id: contestParticipation.id, boundIp: contestParticipation.boundIp },
          { userId: user.id, contestId: contest.id },
          "contestParticipation"
        );
        if (!ipResult.allowed) {
          throw new ForbiddenError("IP address not allowed for this contest");
        }
      }
    }

    if (courseContext?.assessment) {
      const { assessment } = courseContext;
      if (assessment.ipWhitelistEnabled || assessment.ipBindingEnabled) {
        const participation = await assessmentParticipationRepo
          .withTx(tx)
          .upsert(user.id, assessment.id);

        const ipResult = await checkIpLock(
          tx,
          assessment,
          clientIp,
          participation,
          { userId: user.id, assessmentId: assessment.id },
          "assessmentParticipation"
        );
        if (!ipResult.allowed) {
          throw new ForbiddenError("IP address not allowed for this assessment");
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
      mode,
      problemId: problem.id,
      sampleOnly: payload.sampleOnly ?? false,
      sourceCode: payload.sourceCode,
      status: "queued",
      userId: user.id
    });
  });
}
