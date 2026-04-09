import { z } from "zod";
import { judgeTypeSchema } from "../types";
import {
  staticAnalysisConfigSchema,
  scoringConfigSchema,
  artifactConfigSchema,
  networkAccessConfigSchema,
  pipelineStageSchema,
  customScriptConfigSchema,
  subtaskScoringStrategySchema
} from "../pipeline";

// ─── Phase 1 redesign: new judge config shape ─────────────────────
//
// The authoritative judge configuration after the Phase 1 redesign.
// Legacy fields (staticAnalysis, artifacts, networkAccess, customScripts,
// scoring.adjustmentRules, scoring.script, pipeline) remain on the schema
// as optional for backward compatibility and are removed in Phase 5 once
// the runner and UI stop referencing them.

// Languages allowed for Phase 1 checker / interactor scripts. Distinct
// from the legacy pipeline.ts `customScriptLanguageSchema` which stays
// alive for the deprecated pipeline stage API.
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

  // Standard judge: compare mode (Phase 1 new shape)
  compare: compareSchema.optional(),

  // Checker / interactive scripts
  checkerScript: z.string().max(200_000).optional(),
  checkerLanguage: judgeScriptLanguageSchema.optional(),
  interactorScript: z.string().max(200_000).optional(),
  interactorLanguage: judgeScriptLanguageSchema.optional(),

  // Runtime (Phase 1 new). Legacy problems without this fall back to
  // Problem.timeLimitMs / memoryLimitMb at the runner level.
  runtime: runtimeSchema.optional(),

  // Scoring: only subtask strategies after Phase 1. Adjustment rules
  // moved to CourseAssessment / Contest.adjustmentRules.
  scoring: scoringConfigSchema.optional(),

  // ─── Legacy fields (deprecated, removed in Phase 5) ───────────────
  //
  // These keep the schema compatible with existing DB rows until the
  // runner and UI migrate. New UI SHOULD NOT write to them.
  /** @deprecated phase-5 — replaced by `runtime.env` and a future
   *  static-check slot. */
  staticAnalysis: staticAnalysisConfigSchema.optional(),
  /** @deprecated phase-5 — moves to Advanced Mode result contract. */
  artifacts: artifactConfigSchema.optional(),
  /** @deprecated phase-5 — moves to Advanced Mode. */
  networkAccess: networkAccessConfigSchema.optional(),
  /** @deprecated phase-5 — replaced by runner-managed pipeline. */
  pipeline: z
    .object({
      stages: z.array(pipelineStageSchema).min(1).max(20)
    })
    .optional(),
  /** @deprecated phase-5 — moves to Advanced Mode. */
  customScripts: z
    .array(
      customScriptConfigSchema.extend({
        name: z.string().min(1).max(100)
      })
    )
    .max(10)
    .optional()
});

export type JudgeConfig = z.infer<typeof judgeConfigSchema>;
