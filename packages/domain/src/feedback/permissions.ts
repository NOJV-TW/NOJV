import { assessmentRepo, courseMembershipRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
import type { FeedbackContext } from "./types";

async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

export async function canWriteFeedback(
  actor: ActorContext,
  context: FeedbackContext,
): Promise<boolean> {
  if (actor.platformRole === "admin") return true;

  switch (context.type) {
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) return false;
      return isCourseTeacherOrTa(actor.userId, assignment.courseId);
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) return false;
      return isCourseTeacherOrTa(actor.userId, exam.courseId);
    }
  }
}

export async function assertCanViewFeedback(
  actor: ActorContext,
  context: FeedbackContext,
): Promise<void> {
  if (!(await canWriteFeedback(actor, context))) {
    throw new ForbiddenError("Not permitted to view feedback for this context.");
  }
}

export async function assertCanWriteFeedback(
  actor: ActorContext,
  context: FeedbackContext,
): Promise<void> {
  await assertCanViewFeedback(actor, context);
  if (actor.platformRole !== "admin") {
    await assertContextClosed(context);
  }
}
