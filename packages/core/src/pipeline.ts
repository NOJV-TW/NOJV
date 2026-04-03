import { z } from "zod";
import { languageSchema } from "./types";

// ─── Pipeline Stage Types ──────────────────────────────────────────

export const pipelineStageTypes = [
  "compile",
  "static-analysis",
  "execute",
  "check",
  "score",
  "artifact-collect",
  "custom-script"
] as const;

export const pipelineStageTypeSchema = z.enum(pipelineStageTypes);
export type PipelineStageType = z.infer<typeof pipelineStageTypeSchema>;

// ─── Static Analysis Configuration ─────────────────────────────────

export const bannedPatternSchema = z.object({
  pattern: z.string().min(1).max(1_000),
  isRegex: z.boolean().default(false),
  message: z.string().max(500).default("Usage of this pattern is not allowed.")
});

export const staticAnalysisConfigSchema = z.object({
  bannedFunctions: z.array(z.string().min(1).max(200)).max(100).default([]),
  bannedImports: z.array(z.string().min(1).max(200)).max(100).default([]),
  bannedPatterns: z.array(bannedPatternSchema).max(100).default([]),
  linterCommand: z.array(z.string().min(1).max(500)).max(20).optional(),
  failOnLintError: z.boolean().default(true)
});

export type StaticAnalysisConfig = z.infer<typeof staticAnalysisConfigSchema>;

// ─── Scoring Rule Configuration ──────────────────────────────────

export const scoringRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("late_penalty_fixed"),
    perUnit: z.enum(["day", "week"]),
    amount: z.number().min(0).max(100),
    maxDeduction: z.number().min(0).max(100),
  }),
  z.object({
    type: z.literal("late_penalty_decay"),
    halfLifeHours: z.number().min(1).max(8760),
  }),
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0),
  }),
  z.object({
    type: z.literal("memory_penalty"),
    thresholdMb: z.number().min(0),
    maxDeduction: z.number().min(0).max(100),
  }),
]);

export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export const subtaskScoringStrategySchema = z.enum([
  "all_or_nothing",
  "proportional",
  "minimum",
]);

export type SubtaskScoringStrategy = z.infer<typeof subtaskScoringStrategySchema>;

// ─── Custom Scoring Configuration ──────────────────────────────────

export const scoringConfigSchema = z.object({
  // Script mode (overrides rules when script is present)
  script: z.string().min(1).max(200_000).optional(),
  language: languageSchema.or(z.literal("python3")).default("python"),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),

  // Rules mode
  subtaskStrategies: z.record(z.string(), subtaskScoringStrategySchema).optional(),
  adjustmentRules: z.array(scoringRuleSchema).max(10).optional(),
});

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;

export const customScriptLanguageSchema = z.enum([
  "python",
  "python3",
  "c",
  "cpp",
  "go",
  "rust"
]);
export type CustomScriptLanguage = z.infer<typeof customScriptLanguageSchema>;

export const customScriptRunAtSchema = z.enum([
  "before-compile",
  "after-compile",
  "after-check"
]);
export type CustomScriptRunAt = z.infer<typeof customScriptRunAtSchema>;

export const customScriptConfigSchema = z.object({
  script: z.string().min(1).max(200_000),
  language: customScriptLanguageSchema.default("python"),
  timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000),
  runAt: customScriptRunAtSchema.default("after-check")
});

export type CustomScriptConfig = z.infer<typeof customScriptConfigSchema>;

// ─── Artifact Collection Configuration ─────────────────────────────

export const artifactConfigSchema = z.object({
  patterns: z.array(z.string().min(1).max(500)).min(1).max(50),
  maxTotalSizeBytes: z.number().int().min(0).max(50_000_000).default(10_000_000)
});

export type ArtifactConfig = z.infer<typeof artifactConfigSchema>;

// ─── Network Access Configuration ──────────────────────────────────

export const firewallRuleSchema = z.object({
  allow: z.string().min(1).max(500),
  ports: z.array(z.number().int().min(1).max(65535)).max(20).optional(),
  protocol: z.enum(["tcp", "udp", "any"]).default("tcp")
});

export const sidecarServiceSchema = z.object({
  image: z.string().min(1).max(500),
  port: z.number().int().min(1).max(65535),
  env: z.record(z.string(), z.string()).default({}),
  readinessPath: z.string().max(500).optional(),
  memoryMb: z.number().int().min(16).max(1024).default(128)
});

export const networkAccessConfigSchema = z.object({
  enabled: z.boolean().default(false),
  firewallRules: z.array(firewallRuleSchema).max(20).default([]),
  sidecarServices: z.array(sidecarServiceSchema).max(5).default([]),
  logTraffic: z.boolean().default(true)
});

export type NetworkAccessConfig = z.infer<typeof networkAccessConfigSchema>;

// ─── Pipeline Stage Definitions ────────────────────────────────────

export const compileStageSchema = z.object({
  type: z.literal("compile"),
  continueOnFail: z.boolean().default(false)
});

export const staticAnalysisStageSchema = z.object({
  type: z.literal("static-analysis"),
  config: staticAnalysisConfigSchema,
  continueOnFail: z.boolean().default(false)
});

export const executeStageSchema = z.object({
  type: z.literal("execute"),
  continueOnFail: z.boolean().default(false)
});

export const checkStageSchema = z.object({
  type: z.literal("check"),
  continueOnFail: z.boolean().default(false)
});

export const scoreStageSchema = z.object({
  type: z.literal("score"),
  config: scoringConfigSchema,
  continueOnFail: z.boolean().default(true)
});

export const artifactCollectStageSchema = z.object({
  type: z.literal("artifact-collect"),
  config: artifactConfigSchema,
  continueOnFail: z.boolean().default(true)
});

export const customScriptStageSchema = z.object({
  type: z.literal("custom-script"),
  name: z.string().min(1).max(100),
  config: customScriptConfigSchema,
  continueOnFail: z.boolean().default(true)
});

export type CustomScriptStage = z.infer<typeof customScriptStageSchema>;

export const pipelineStageSchema = z.discriminatedUnion("type", [
  compileStageSchema,
  staticAnalysisStageSchema,
  executeStageSchema,
  checkStageSchema,
  scoreStageSchema,
  artifactCollectStageSchema,
  customScriptStageSchema
]);

export type PipelineStage = z.infer<typeof pipelineStageSchema>;

// ─── Full Pipeline Configuration ───────────────────────────────────

export const pipelineConfigSchema = z.object({
  stages: z.array(pipelineStageSchema).min(1).max(20),
  networkAccess: networkAccessConfigSchema.optional()
});

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

// ─── Pipeline Stage Results ────────────────────────────────────────

export const staticAnalysisViolationSchema = z.object({
  line: z.number().int().nonnegative().optional(),
  column: z.number().int().nonnegative().optional(),
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"])
});

export type StaticAnalysisViolation = z.infer<typeof staticAnalysisViolationSchema>;

export const staticAnalysisResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(staticAnalysisViolationSchema)
});

export type StaticAnalysisResult = z.infer<typeof staticAnalysisResultSchema>;

export const artifactEntrySchema = z.object({
  path: z.string(),
  sizeBytes: z.number().int().nonnegative()
});

export type ArtifactEntry = z.infer<typeof artifactEntrySchema>;

export const customScriptStageResultSchema = z.object({
  name: z.string(),
  runAt: customScriptRunAtSchema,
  passed: z.boolean(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  feedback: z.string().optional(),
  metadata: z.unknown().optional()
});

export type CustomScriptStageResult = z.infer<typeof customScriptStageResultSchema>;

// ─── Extended Sandbox Output ───────────────────────────────────────

export const pipelineResultSchema = z.object({
  staticAnalysis: staticAnalysisResultSchema.optional(),
  artifacts: z.array(artifactEntrySchema).optional(),
  customStageResults: z.array(customScriptStageResultSchema).optional(),
  customScore: z.number().int().min(0).max(100).optional(),
  scoringFeedback: z.string().optional()
});

export type PipelineResult = z.infer<typeof pipelineResultSchema>;

// ─── Default Pipeline (backward-compatible) ────────────────────────

export function getDefaultPipeline(): PipelineConfig {
  return {
    stages: [
      { type: "compile", continueOnFail: false },
      { type: "execute", continueOnFail: false },
      { type: "check", continueOnFail: false }
    ]
  };
}
