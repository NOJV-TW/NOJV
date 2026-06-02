import { ValidationError } from "../shared/errors";

export type ScoreOverrideContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string };

export type ScoreOverrideContextType = ScoreOverrideContext["type"];

export function toContextDbFields(ctx: ScoreOverrideContext): {
  contextType: ScoreOverrideContextType;
  contextId: string;
} {
  switch (ctx.type) {
    case "assignment":
      return { contextType: "assignment", contextId: ctx.assignmentId };
    case "exam":
      return { contextType: "exam", contextId: ctx.examId };
    case "contest":
      return { contextType: "contest", contextId: ctx.contestId };
  }
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
    case "contest":
      return { type: "contest", contestId: row.contextId };
    default:
      throw new ValidationError(`Unknown score-override contextType: ${row.contextType}`);
  }
}
