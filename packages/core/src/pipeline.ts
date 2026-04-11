import { z } from "zod";

// Subtask scoring strategy — drives `JudgeConfig.scoring.subtaskStrategies`,
// which is how the runner groups testcase results into subtask scores.

export const subtaskScoringStrategySchema = z.enum([
  "all_or_nothing",
  "proportional",
  "minimum"
]);

export type SubtaskScoringStrategy = z.infer<typeof subtaskScoringStrategySchema>;
