import { z } from "zod";
import type { SandboxResult } from "@nojv/core";

const sandboxTestcaseResultSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number(),
  score: z.number().optional(),
  feedback: z.string().optional()
});

const staticAnalysisViolationSchema = z.object({
  line: z.number().optional(),
  column: z.number().optional(),
  rule: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"])
});

const staticAnalysisResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(staticAnalysisViolationSchema)
});

const artifactEntrySchema = z.object({
  path: z.string(),
  sizeBytes: z.number()
});

const customScriptStageResultSchema = z.object({
  name: z.string(),
  runAt: z.enum(["before-compile", "after-compile", "after-check"]),
  passed: z.boolean(),
  exitCode: z.number(),
  timedOut: z.boolean(),
  feedback: z.string().optional(),
  metadata: z.unknown().optional()
});

const rawSchema = z.object({
  compilationError: z.string().optional(),
  pipelineError: z.string().optional(),
  testcaseResults: z.array(sandboxTestcaseResultSchema),
  staticAnalysis: staticAnalysisResultSchema.optional(),
  artifacts: z.array(artifactEntrySchema).optional(),
  customStageResults: z.array(customScriptStageResultSchema).optional(),
  customScore: z.number().optional(),
  scoringFeedback: z.string().optional()
});

export function parseSandboxResult(data: unknown) {
  const result = rawSchema.safeParse(data);
  if (!result.success) return { success: false as const };
  return { success: true as const, data: result.data as unknown as SandboxResult };
}
