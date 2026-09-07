import { z } from "zod";

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
const sandboxVerdictSchema = z.enum(sandboxVerdicts);

export const sandboxTestcaseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: sandboxVerdictSchema,
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number().nonnegative(),
  memoryKb: z.number().nonnegative().optional(),
  feedback: z.string().optional(),
  staffFeedback: z.string().optional(),
});

export const rawCaseRunSchema = z.object({
  index: z.number().int().nonnegative(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number().nonnegative(),
  memoryKb: z.number().nonnegative().optional(),
  errorVerdict: z.enum(["TLE", "MLE", "RE", "SE"]).optional(),
});

export const sandboxOutputSchema = z
  .object({
    compilationError: z.string().optional(),
    pipelineError: z.string().optional(),
    testcaseResults: z.array(sandboxTestcaseResultSchema).optional(),
    rawRuns: z.array(rawCaseRunSchema).optional(),
    customScore: z.number().optional(),
    scoringFeedback: z.string().optional(),
    overallVerdict: sandboxVerdictSchema.optional(),
  })
  .refine(
    (value) =>
      value.testcaseResults !== undefined ||
      value.rawRuns !== undefined ||
      value.compilationError !== undefined ||
      value.pipelineError !== undefined,
    "Sandbox output must contain results or an error.",
  )
  .transform((value) => ({ ...value, testcaseResults: value.testcaseResults ?? [] }));

export const compileOutputSchema = z
  .object({
    compilationError: z.string().optional(),
    runCommand: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine(
    (value) => value.compilationError !== undefined || value.runCommand !== undefined,
    "Compile output must contain a run command or a compilation error.",
  );

export const validatorCaseOutcomeSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.enum(["AC", "WA", "SE"]),
  teamMessage: z.string().optional(),
  judgeMessage: z.string().optional(),
});

export const validateOutputSchema = z
  .object({
    compilationError: z.string().optional(),
    validatorOutcomes: z.array(validatorCaseOutcomeSchema).optional(),
  })
  .refine(
    (value) => value.compilationError !== undefined || value.validatorOutcomes !== undefined,
    "Validate output must contain verdicts or a compilation error.",
  );

export type CompileOutput = z.infer<typeof compileOutputSchema>;
export type ValidateOutput = z.infer<typeof validateOutputSchema>;
export type ValidatorCaseOutcome = z.infer<typeof validatorCaseOutcomeSchema>;
