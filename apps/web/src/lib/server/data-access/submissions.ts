import { prisma } from "@nojv/db";
import type { SubmissionDraft } from "@nojv/domain";

import type { CompletedActorContext } from "../actor-context";
import {
  ensureContestParticipation,
  ensureUser,
  requireCourseAssessment,
  requireProblem
} from "./shared";

export async function createQueuedSubmissionRecord(
  payload: SubmissionDraft,
  actor: CompletedActorContext
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const problem = await requireProblem(tx, payload.problemSlug);
    const contestParticipation = payload.contestSlug
      ? await ensureContestParticipation(tx, user.id, payload.contestSlug)
      : null;
    const courseContext = payload.assessment
      ? await requireCourseAssessment(
          tx,
          payload.assessment.courseSlug,
          payload.assessment.assessmentSlug
        )
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
        mode: payload.mode,
        problemId: problem.id,
        sampleOnly: payload.sampleOnly ?? false,
        sourceCode: payload.sourceCode,
        status: "queued",
        userId: user.id
      }
    });
  });
}
