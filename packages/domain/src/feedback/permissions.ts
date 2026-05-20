import { assessmentRepo, courseMembershipRepo, examRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { assertContextClosed } from "../shared/context-window";
import { ForbiddenError } from "../shared/errors";
import type { FeedbackContext } from "./types";

// Same shape as score-override/permissions.ts's private helper — replicated
// locally to avoid leaking a private helper across modules. Keep in sync if
// the course-staff definition ever widens.
async function isCourseTeacherOrTa(userId: string, courseId: string): Promise<boolean> {
  const membership = await courseMembershipRepo.findByComposite(courseId, userId);
  if (membership?.status !== "active") return false;
  return membership.role === "teacher" || membership.role === "ta";
}

/**
 * Can `actor` write / delete grading feedback in the given context?
 *
 * Mirrors `canSetScoreOverride` for the assignment + exam branches:
 *
 *   - platform admin → always
 *   - assignment     → course teacher/TA
 *   - exam           → course teacher/TA (via `Exam.courseId`)
 */
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

/**
 * Role-only assert: throws `ForbiddenError` unless `actor` is course staff
 * (or a platform admin) for `context`. Does NOT apply the post-close gate —
 * use this to authorize *reads* (listing feedback), which staff may do while
 * a context is still open. Writes must use `assertCanWriteFeedback`.
 */
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
  // Feedback is a post-close grading action: course staff may only write
  // it once the context has ended. Platform admins bypass the gate.
  if (actor.platformRole !== "admin") {
    await assertContextClosed(context);
  }
}
