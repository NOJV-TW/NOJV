import { z } from "zod";
import type { SandboxResult, ValidatorOutcome } from "@nojv/core";

const sandboxTestcaseResultSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number(),
  memoryKb: z.number().optional(),
  score: z.number().optional(),
  feedback: z.string().optional(),
});

// Raw per-case run emitted by the runner in standard mode (no AC/WA decision).
const rawCaseRunSchema = z.object({
  index: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number(),
  memoryKb: z.number().optional(),
  errorVerdict: z.enum(["TLE", "MLE", "RE", "SE"]).optional(),
});

const rawSchema = z
  .object({
    compilationError: z.string().optional(),
    pipelineError: z.string().optional(),
    // Standard mode emits `rawRuns`; checker/interactive emit `testcaseResults`.
    testcaseResults: z.array(sandboxTestcaseResultSchema).optional(),
    rawRuns: z.array(rawCaseRunSchema).optional(),
    customScore: z.number().optional(),
    scoringFeedback: z.string().optional(),
  })
  // Fail closed on payloads that carry neither result channel — the runner
  // always emits exactly one. A bare object would otherwise parse and grade
  // as an empty (zero-testcase) run.
  .refine((v) => v.testcaseResults !== undefined || v.rawRuns !== undefined);

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

// Per-case outcome emitted by the isolated validate container.
const validatorCaseOutcomeSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "SE"]),
  score: z.number().optional(),
  teamMessage: z.string().optional(),
  judgeMessage: z.string().optional(),
});

const validateOutputSchema = z
  .object({
    compilationError: z.string().optional(),
    validatorOutcomes: z.array(validatorCaseOutcomeSchema).optional(),
  })
  .refine((v) => v.compilationError !== undefined || v.validatorOutcomes !== undefined);

export interface ValidateOutput {
  compilationError?: string;
  validatorOutcomes?: (ValidatorOutcome & { index: number })[];
}

export function parseValidateOutput(
  data: unknown,
): { success: true; data: ValidateOutput } | { success: false } {
  const result = validateOutputSchema.safeParse(data);
  if (!result.success) return { success: false };
  return { success: true, data: result.data as unknown as ValidateOutput };
}
