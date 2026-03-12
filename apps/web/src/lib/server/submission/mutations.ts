import { prisma } from "@nojv/db";
import type { SubmissionDraft } from "@nojv/core";

import type { CompletedActorContext } from "../auth";
import { ForbiddenError } from "../auth";
import { ensureUser } from "../user/mutations";
import { requireCourseAssessment } from "../course/mutations";
import { requireProblem } from "../problem/mutations";
import { ensureContestParticipation } from "../contest/mutations";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext
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
  const mode = payload.contestSlug
    ? "contest"
    : courseContext
      ? courseContext.assessment.type
      : "practice";

  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;

    // Enforce attempt limit for assignment/exam submissions (not sampleOnly runs)
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
