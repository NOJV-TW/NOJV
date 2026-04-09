import { z } from "zod";
import { judgeTypeSchema } from "../types";
import { subtaskScoringStrategySchema } from "../pipeline";

// ─── Phase 1 redesign: judge config shape ─────────────────────────
//
// Authoritative judge configuration. After the Phase 5 cleanup all
// legacy fields (staticAnalysis, artifacts, networkAccess, pipeline,
// customScripts) are removed.

export const judgeScriptLanguageSchema = z.enum(["bash", "python", "node", "c", "cpp"]);

export type JudgeScriptLanguage = z.infer<typeof judgeScriptLanguageSchema>;

export const compareModeSchema = z.enum([
  "exact",
  "ignore_whitespace",
  "ignore_case",
  "float",
  "regex_filter"
]);

export type CompareMode = z.infer<typeof compareModeSchema>;

export const compareSchema = z.object({
  mode: compareModeSchema.default("exact"),
  floatAbsTol: z.number().min(0).optional(),
  floatRelTol: z.number().min(0).optional(),
  ignoreLinePatterns: z.array(z.string().max(1_000)).max(20).optional()
});

export type Compare = z.infer<typeof compareSchema>;

export const runtimeSchema = z.object({
  timeLimitMs: z.coerce.number().int().min(100).max(30_000).default(1_000),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  env: z.record(z.string().min(1).max(200), z.string().max(4_000)).default({})
});

export type Runtime = z.infer<typeof runtimeSchema>;

export const judgeScoringSchema = z.object({
  subtaskStrategies: z.record(z.string(), subtaskScoringStrategySchema).default({})
});

export type JudgeScoring = z.infer<typeof judgeScoringSchema>;

export const judgeConfigSchema = z.object({
  type: judgeTypeSchema.default("standard"),

  // Standard judge: compare mode
  compare: compareSchema.optional(),

  // Checker / interactive scripts
  checkerScript: z.string().max(200_000).optional(),
  checkerLanguage: judgeScriptLanguageSchema.optional(),
  interactorScript: z.string().max(200_000).optional(),
  interactorLanguage: judgeScriptLanguageSchema.optional(),

  // Runtime: authoritative source for time/memory limits + env.
  runtime: runtimeSchema.optional(),

  // Scoring: only subtask strategies after Phase 1. Adjustment rules
  // moved to CourseAssessment / Contest.adjustmentRules.
  scoring: judgeScoringSchema.optional()
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
