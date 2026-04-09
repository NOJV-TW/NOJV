import { z } from "zod";

// ─── Subtask scoring strategy ──────────────────────────────────────
//
// The only pipeline-era type that survives after Phase 5 cleanup. It
// still drives JudgeConfig.scoring.subtaskStrategies which is how the
// runner groups testcase results into subtask scores.
//
// Historical note: this file used to export a full pipeline DSL
// (compile / static-analysis / execute / check / score / artifact /
// custom-script stages) plus configuration schemas for each. All of
// those were removed when the sandbox runner stopped interpreting a
// user-configurable pipeline and moved to a fixed flow. See
// docs/plans/active/2026-04-09-problem-ui-redesign.md for rationale.

export const subtaskScoringStrategySchema = z.enum([
  "all_or_nothing",
  "proportional",
  "minimum"
]);

export type SubtaskScoringStrategy = z.infer<typeof subtaskScoringStrategySchema>;
