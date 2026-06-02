import { ValidationError } from "../shared/errors";

export type ClarificationContext =
  | { type: "assignment"; assignmentId: string }
  | { type: "exam"; examId: string }
  | { type: "contest"; contestId: string };

export type ClarificationContextType = ClarificationContext["type"];

export function toContextDbFields(ctx: ClarificationContext): {
  contextType: ClarificationContextType;
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
}): ClarificationContext {
  switch (row.contextType) {
    case "assignment":
      return { type: "assignment", assignmentId: row.contextId };
    case "exam":
      return { type: "exam", examId: row.contextId };
    case "contest":
      return { type: "contest", contestId: row.contextId };
    default:
      throw new ValidationError(`Unknown clarification contextType: ${row.contextType}`);
  }
}
