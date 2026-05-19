import { assessmentRepo, contestRepo, examRepo } from "@nojv/db";

import { ConflictError, NotFoundError } from "./errors";

/**
 * A gradable context whose close time gates post-close staff actions
 * (score overrides, written feedback).
 *
 * This is a SHARED helper: the type is defined here rather than imported
 * from a feature module so `shared/` never depends on a feature. The
 * `score-override` feature's `ScoreOverrideContext` is structurally
 * identical and can be passed directly; the `feedback` feature passes a
 * subset (assignment | exam).
 */
export type GradableContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string };

/**
 * Has the context's hard close time passed?
 *
 * Close time per type: `CourseAssessment.closesAt`, `Exam.endsAt`,
 * `Contest.endsAt`.
 *
 * A missing context row throws `NotFoundError` rather than reporting
 * "not closed" — a missing context is a data error, and silently
 * treating it as open would leave the caller's gate ineffective.
 */
export async function isContextClosed(context: GradableContext): Promise<boolean> {
  const now = Date.now();

  switch (context.type) {
    case "assignment": {
      const assignment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assignment) throw new NotFoundError("Assignment not found.");
      return now > assignment.closesAt.getTime();
    }
    case "exam": {
      const exam = await examRepo.findById(context.examId);
      if (!exam) throw new NotFoundError("Exam not found.");
      return now > exam.endsAt.getTime();
    }
    case "contest": {
      const contest = await contestRepo.findById(context.contestId);
      if (!contest) throw new NotFoundError("Contest not found.");
      return now > contest.endsAt.getTime();
    }
  }
}

/**
 * Throws `ConflictError` (HTTP 409) when the context is still open.
 * Use to gate grading actions that may only happen after a context
 * has ended.
 */
export async function assertContextClosed(context: GradableContext): Promise<void> {
  if (!(await isContextClosed(context))) {
    throw new ConflictError(
      "This context is still open; grading is only available after it closes.",
    );
  }
}
