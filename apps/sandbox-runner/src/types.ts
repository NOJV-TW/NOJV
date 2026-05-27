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

// Config schema for validating /submission/config.json.
// Uses domain enums from @nojv/core. The sandbox-runner runs the
// submission as-is; `problemType` is preserved for diagnostics.
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
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

// Optional per-testcase metadata sitting next to input/expected on disk.
// Both fields default to loader-level values when missing or invalid.
export const TestcaseMetaSchema = z.object({
  weight: z.number().optional(),
  isSample: z.boolean().optional(),
});

export type TestcaseMeta = z.infer<typeof TestcaseMetaSchema>;

// Testcase files read from disk (not from config.json)
export interface TestcaseFiles {
  index: number;
  input: string;
  expected?: string | undefined;
  weight: number;
  isSample: boolean;
}

// Re-export for backward compatibility within sandbox-runner
// (judges import TestcaseResult from types.ts)
export type { SandboxTestcaseResult as TestcaseResult } from "@nojv/core";

// Re-export for index.ts which constructs SandboxOutput
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
  score: z.number().optional(),
  feedback: z.string().optional(),
});

// Raw per-case run for worker-side checking (standard mode). `errorVerdict`
// is only ever a run-failure code; AC/WA is decided by the worker.
const rawCaseRunSchema = z.object({
  index: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  timeMs: z.number(),
  memoryKb: z.number().optional(),
  errorVerdict: z.enum(["TLE", "MLE", "RE", "SE"]).optional(),
});

// Shape the runner emits on stdout. Mirrors @nojv/core `SandboxResult`.
export const SandboxOutputSchema = z.object({
  compilationError: z.string().optional(),
  pipelineError: z.string().optional(),
  testcaseResults: z.array(sandboxTestcaseResultSchema).optional(),
  rawRuns: z.array(rawCaseRunSchema).optional(),
  customScore: z.number().optional(),
  scoringFeedback: z.string().optional(),
});
