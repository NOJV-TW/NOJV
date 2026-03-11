import { z } from "zod";
import { languageSchema, judgeTypeSchema, submissionTypeSchema } from "@nojv/core";

export type {
  SandboxConfig,
  SandboxResult,
  SandboxTestcase,
  SandboxTestcaseResult,
  SandboxVerdict
} from "@nojv/core";

// Config schema for validating /submission/config.json
// Uses domain enums from @nojv/core for consistency
export const SandboxInputSchema = z.object({
  submissionId: z.string(),
  language: languageSchema,
  judgeType: judgeTypeSchema,
  submissionType: submissionTypeSchema,
  limits: z.object({
    timeoutMs: z.number(),
    memoryMb: z.number()
  }),
  template: z
    .object({
      driverCode: z.string(),
      insertionMarker: z.string()
    })
    .optional(),
  checkerLanguage: z.string().optional(),
  interactorLanguage: z.string().optional()
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

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
