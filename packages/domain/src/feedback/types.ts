import type { SubmissionFeedbackContext } from "@nojv/db";

import { ValidationError } from "../shared/errors";

/**
 * Discriminated union for grading-feedback contexts. Mirrors
 * `ScoreOverrideContext` but with only two members — feedback can only be
 * written against an assignment or an exam (no contest, no practice).
 *
 * Structurally a subset of `GradableContext`, so a `FeedbackContext` can be
 * passed straight into `isContextClosed` / `assertContextClosed`.
 *
 * The DB stores the context as the flat column pair
 * `SubmissionFeedback.courseAssessmentId` / `.examId` (exactly one non-null).
 * `toContextDbFields` / `fromContextDbFields` translate at the repo boundary.
 */
export type FeedbackContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string };

export type FeedbackContextType = FeedbackContext["type"];

/**
 * Translate a domain `FeedbackContext` into the repo's
 * `SubmissionFeedbackContext` discriminated union (exactly one column set).
 */
export function toContextDbFields(ctx: FeedbackContext): SubmissionFeedbackContext {
  switch (ctx.type) {
    case "assignment":
      return { courseAssessmentId: ctx.assignmentId };
    case "exam":
      return { examId: ctx.examId };
  }
}

/**
 * Reverse of `toContextDbFields`: turn a fetched `SubmissionFeedback` row's
 * `courseAssessmentId` / `examId` columns back into a `FeedbackContext`.
 */
export function fromContextDbFields(row: {
  courseAssessmentId: string | null;
  examId: string | null;
}): FeedbackContext {
  if (row.courseAssessmentId !== null) {
    return { type: "assignment", assignmentId: row.courseAssessmentId };
  }
  if (row.examId !== null) {
    return { type: "exam", examId: row.examId };
  }
  throw new ValidationError("Submission feedback row has no context id.");
}
