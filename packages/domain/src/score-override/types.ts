import { ValidationError } from "../shared/errors";

/**
 * Discriminated union for score-override contexts. Replaces the legacy
 * `(contextType: OverrideContextType, contextId: string)` pair on every
 * domain function signature so callers cannot pair `examId` with
 * `contextType: "contest"` etc.
 *
 * Practice is intentionally NOT a member — practice submissions cannot
 * carry an override, and the DB enum `OverrideContextType` enforces
 * that at the storage layer.
 *
 * The DB column pair (`ScoreOverride.contextType` + `.contextId`)
 * stays flat. `toContextDbFields` / `fromContextDbFields` translate at
 * the repository boundary.
 */
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
