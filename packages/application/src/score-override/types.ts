import { ValidationError } from "../shared/errors";
import type { GradedContext } from "../shared/graded-context";

export type ScoreOverrideContext = Exclude<GradedContext, { type: "contest" }>;
export type ScoreOverrideContextType = ScoreOverrideContext["type"];

export function toContextDbFields(ctx: ScoreOverrideContext): {
  contextType: ScoreOverrideContextType;
  contextId: string;
} {
  return ctx.type === "assignment"
    ? { contextType: "assignment", contextId: ctx.assignmentId }
    : { contextType: "exam", contextId: ctx.examId };
}

export function fromContextDbFields(row: {
  contextType: string;
  contextId: string;
}): ScoreOverrideContext {
  switch (row.contextType) {
    case "assignment":
      return { type: "assignment", assignmentId: row.contextId };
    case "exam":
      return { type: "exam", examId: row.contextId };
    default:
      throw new ValidationError(`Unknown contextType: ${row.contextType}`);
  }
}
