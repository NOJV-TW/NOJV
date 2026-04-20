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
  feedback: z.string().optional(),
});

const rawSchema = z.object({
  compilationError: z.string().optional(),
  pipelineError: z.string().optional(),
  testcaseResults: z.array(sandboxTestcaseResultSchema),
  customScore: z.number().optional(),
  scoringFeedback: z.string().optional(),
});

export function parseSandboxResult(
  data: unknown,
): { success: true; data: SandboxResult } | { success: false } {
  const result = rawSchema.safeParse(data);
  if (!result.success) return { success: false };
  // Zod's `.optional()` infers `T | undefined`, which under
  // `exactOptionalPropertyTypes: true` doesn't unify with `prop?: T`.
  // The shape is structurally identical — assert through unknown.
  return { success: true, data: result.data as unknown as SandboxResult };
}
