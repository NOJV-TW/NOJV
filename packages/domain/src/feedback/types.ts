import type { SubmissionFeedbackContext } from "@nojv/db";

import { ValidationError } from "../shared/errors";

export type FeedbackContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string };

export type FeedbackContextType = FeedbackContext["type"];

export function toContextDbFields(ctx: FeedbackContext): SubmissionFeedbackContext {
  switch (ctx.type) {
    case "assignment":
      return { assessmentId: ctx.assignmentId };
    case "exam":
      return { examId: ctx.examId };
  }
}

export function fromContextDbFields(row: {
  assessmentId: string | null;
  examId: string | null;
}): FeedbackContext {
  if (row.assessmentId !== null) {
    return { type: "assignment", assignmentId: row.assessmentId };
  }
  if (row.examId !== null) {
    return { type: "exam", examId: row.examId };
  }
  throw new ValidationError("Submission feedback row has no context id.");
}
