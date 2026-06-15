import { z } from "zod";
import {
  judgeScriptLanguageSchema,
  judgeTypeSchema,
  languageSchema,
  problemTypeSchema,
} from "@nojv/core";

export type {
  SandboxResult,
  SandboxTestcase,
  SandboxTestcaseResult,
  SandboxVerdict,
} from "@nojv/core";

export const SandboxInputSchema = z.object({
  submissionId: z.string(),
  language: languageSchema,
  judgeType: judgeTypeSchema,
  problemType: problemTypeSchema,
  entryFile: z.string().min(1).max(300).optional(),
  sourceFiles: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        content: z.string(),
      }),
    )
    .max(200)
    .optional(),
  sourceFileMap: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        key: z.string().min(1).max(300),
      }),
    )
    .max(200)
    .optional(),
  limits: z.object({
    timeoutMs: z.number(),
    memoryMb: z.number(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  checkerLanguage: judgeScriptLanguageSchema.optional(),
  interactorLanguage: judgeScriptLanguageSchema.optional(),
  validate: z
    .object({
      language: judgeScriptLanguageSchema,
      cases: z.array(z.object({ index: z.number() })).max(2000),
    })
    .optional(),
  interactive: z
    .object({
      role: z.enum(["solution", "validator"]),
      language: judgeScriptLanguageSchema.optional(),
      index: z.number().optional(),
    })
    .optional(),
  mode: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("compile") }),
      z.object({
        kind: z.literal("run-case"),
        caseIndex: z.number(),
        runCommand: z.array(z.string()).min(1),
      }),
    ])
    .optional(),
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

export const TestcaseMetaSchema = z.object({
  weight: z.number().optional(),
  isSample: z.boolean().optional(),
});

export type TestcaseMeta = z.infer<typeof TestcaseMetaSchema>;

export interface TestcaseFiles {
  index: number;
  input: string;
  expected?: string | undefined;
  weight: number;
  isSample: boolean;
}

export type { SandboxTestcaseResult as TestcaseResult } from "@nojv/core";

export type { SandboxResult as SandboxOutput } from "@nojv/core";

const sandboxVerdictSchema = z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]);

const sandboxTestcaseResultSchema = z.object({
  index: z.number(),
  verdict: sandboxVerdictSchema,
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

export const SandboxOutputSchema = z.object({
  compilationError: z.string().optional(),
  pipelineError: z.string().optional(),
  testcaseResults: z.array(sandboxTestcaseResultSchema).optional(),
  rawRuns: z.array(rawCaseRunSchema).optional(),
  customScore: z.number().optional(),
  scoringFeedback: z.string().optional(),
});

export const CompileOutputSchema = z.object({
  compilationError: z.string().optional(),
  runCommand: z.array(z.string()).optional(),
});

export type CompileOutput = z.infer<typeof CompileOutputSchema>;

const validatorCaseOutcomeSchema = z.object({
  index: z.number(),
  verdict: z.enum(["AC", "WA", "SE"]),
  teamMessage: z.string().optional(),
  judgeMessage: z.string().optional(),
});

export type ValidatorCaseOutcome = z.infer<typeof validatorCaseOutcomeSchema>;

export const ValidateOutputSchema = z.object({
  compilationError: z.string().optional(),
  validatorOutcomes: z.array(validatorCaseOutcomeSchema).optional(),
});

export type ValidateOutput = z.infer<typeof ValidateOutputSchema>;
