/**
 * Discriminated union describing the three kinds of context a
 * clarification thread can live in. Replaces the legacy
 * `(contextType: string, contextId: string)` pair on every domain
 * function signature so callers cannot accidentally swap arguments or
 * pair an `examId` with `contextType: "contest"`.
 *
 * The DB column pair (`Clarification.contextType` + `.contextId`) stays
 * flat — `toContextDbFields` / `fromContextDbFields` translate at the
 * repository boundary.
 */
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
      throw new Error(`Unknown clarification contextType: ${row.contextType}`);
  }
}
