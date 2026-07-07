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
  feedback: z.string().optional(),
});

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
    testcaseResults: z.array(sandboxTestcaseResultSchema).optional(),
    rawRuns: z.array(rawCaseRunSchema).optional(),
    customScore: z.number().optional(),
    scoringFeedback: z.string().optional(),
  })
  .refine((v) => v.testcaseResults !== undefined || v.rawRuns !== undefined);

export function parseSandboxResult(
  data: unknown,
): { success: true; data: SandboxResult } | { success: false } {
  const result = rawSchema.safeParse(data);
  if (!result.success) return { success: false };
  return {
    success: true,
    data: {
      ...result.data,
      testcaseResults: result.data.testcaseResults ?? [],
    } as SandboxResult,
  };
}

const validatorCaseOutcomeSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "SE"]),
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
  return { success: true, data: result.data as ValidateOutput };
}

const compileOutputSchema = z.object({
  compilationError: z.string().optional(),
  runCommand: z.array(z.string()).optional(),
});

export interface CompileOutput {
  compilationError?: string;
  runCommand?: string[];
}

export function parseCompileOutput(
  data: unknown,
): { success: true; data: CompileOutput } | { success: false } {
  const result = compileOutputSchema.safeParse(data);
  if (!result.success) return { success: false };
  const output: CompileOutput = {};
  if (result.data.compilationError !== undefined)
    output.compilationError = result.data.compilationError;
  if (result.data.runCommand !== undefined) output.runCommand = result.data.runCommand;
  return { success: true, data: output };
}
