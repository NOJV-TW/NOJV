import { z } from "zod";
import {
  compareOptionsSchema,
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
  compare: compareOptionsSchema.nullish(),
  checkerLanguage: judgeScriptLanguageSchema.optional(),
  interactorLanguage: judgeScriptLanguageSchema.optional(),
  validate: z.object({ language: judgeScriptLanguageSchema }).optional(),
  interactive: z
    .discriminatedUnion("role", [
      z.object({
        role: z.literal("solution"),
        cases: z.array(z.number().int().nonnegative()).min(1).max(2000),
      }),
      z.object({
        role: z.literal("validator"),
        language: judgeScriptLanguageSchema,
        cases: z.array(z.number().int().nonnegative()).min(1).max(2000),
      }),
    ])
    .optional(),
  mode: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("compile") }),
      z.object({
        kind: z.literal("run-stage"),
        caseIndices: z.array(z.number().int().nonnegative()).max(2000),
        parallelism: z.number().int().min(1).max(16).default(1),
        runCommand: z.array(z.string().min(1)).min(1).optional(),
      }),
      z.object({ kind: z.literal("judge-stage") }),
    ])
    .optional(),
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

export interface TestcaseFiles {
  index: number;
  input: string;
}

export {
  sandboxOutputSchema as SandboxOutputSchema,
  compileOutputSchema as CompileOutputSchema,
  validateOutputSchema as ValidateOutputSchema,
} from "@nojv/core";
export type {
  SandboxTestcaseResult as TestcaseResult,
  SandboxResult as SandboxOutput,
  CompileOutput,
  ValidateOutput,
  ValidatorCaseOutcome,
} from "@nojv/core";
