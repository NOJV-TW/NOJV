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
      cases: z.array(z.object({ index: z.number().int().nonnegative() })).max(2000),
    })
    .optional(),
  interactive: z
    .discriminatedUnion("role", [
      z.object({ role: z.literal("solution") }),
      z.object({
        role: z.literal("validator"),
        language: judgeScriptLanguageSchema,
        index: z.number().int().nonnegative(),
      }),
    ])
    .optional(),
  mode: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("compile") }),
      z.object({
        kind: z.literal("run-case"),
        caseIndex: z.number().int().nonnegative(),
        runCommand: z.array(z.string().min(1)).min(1),
      }),
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
