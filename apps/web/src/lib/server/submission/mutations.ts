import { prisma } from "@nojv/db";
import type { SubmissionDraft } from "@nojv/core";

import type { CompletedActorContext } from "../auth";
import { ForbiddenError } from "../auth";
import { checkIpLock, getClientIp } from "../ip-utils";
import { ensureUser } from "../user/mutations";
import { requireCourseAssessment } from "../course/mutations";
import { requireProblem } from "../problem/mutations";
import { checkSubmitCooldown, ensureContestParticipation } from "../contest/mutations";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext,
  request: Request
) {
  const problem = await requireProblem(prisma, payload.problemSlug);
  const courseContext = payload.assessment
    ? await requireCourseAssessment(
        prisma,
        payload.assessment.courseSlug,
        payload.assessment.assessmentSlug
      )
    : null;

  // ── Authorization: verify user is enrolled in the course ──
  if (courseContext) {
    const membership = await prisma.courseMembership.findUnique({
      where: {
        courseId_userId: {
          courseId: courseContext.course.id,
          userId: actor.userId
        }
      }
    });

    if (membership?.status !== "active") {
      throw new ForbiddenError("You are not enrolled in this course.");
    }
  }

  // ── Derive mode from server context, ignore client-provided mode ──
  const mode = payload.contestSlug ? "contest" : courseContext ? "assignment" : "practice";

  return prisma.$transaction(async (tx) => {
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

    // ── Language restriction: function-mode template availability ──
    if (problem.submissionType === "function") {
      const template = await tx.problemTemplate.findFirst({
        where: { problemId: problem.id, language: payload.language },
        select: { id: true }
      });
      if (!template) {
        throw new ForbiddenError("No template available for this language");
      }
    }

    // ── IP lock recheck ──
    const clientIp = getClientIp(request);

    if (contestResult) {
      const { contest } = contestResult;
      if (contest.ipWhitelistEnabled || contest.ipBindingEnabled) {
        const ipResult = await checkIpLock(
          contest,
          clientIp,
          { id: contestParticipation!.id, boundIp: contestParticipation!.boundIp },
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
        const participation = await tx.assessmentParticipation.upsert({
          where: {
            userId_assessmentId: {
              userId: user.id,
              assessmentId: assessment.id
            }
          },
          create: {
            userId: user.id,
            assessmentId: assessment.id
          },
          update: {},
          select: { id: true, boundIp: true }
        });

        const ipResult = await checkIpLock(
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
        const attemptCount = await tx.submission.count({
          where: {
            courseAssessmentId: courseContext.assessment.id,
            problemId: problem.id,
            sampleOnly: false,
            userId: user.id
          }
        });

        if (attemptCount >= maxAttempts) {
          throw new Error(
            `Attempt limit reached (${String(maxAttempts)}/${String(maxAttempts)}).`
          );
        }
      }
    }

    return tx.submission.create({
      data: {
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
      }
    });
  });
}
