import { z } from "zod";

// Input: read from /submission/config.json
export const SandboxInputSchema = z.object({
  submissionId: z.string(),
  language: z.enum(["c", "cpp", "go", "java", "javascript", "python", "rust", "typescript"]),
  judgeType: z.enum(["standard", "checker", "interactive"]),
  submissionType: z.enum(["function", "full_source"]),
  limits: z.object({
    timeoutMs: z.number(),
    memoryMb: z.number()
  }),
  // For function mode: template with insertion marker
  template: z
    .object({
      driverCode: z.string(),
      insertionMarker: z.string()
    })
    .optional(),
  // For checker/interactive
  checkerLanguage: z.string().optional()
});

export type SandboxInput = z.infer<typeof SandboxInputSchema>;

// Testcase: read from /submission/testcases/{index}/
export interface TestcaseFiles {
  index: number;
  input: string; // stdin content
  expected?: string | undefined; // expected stdout (for standard judge)
  weight: number;
  isSample: boolean;
}

// Output: written to stdout as JSON
export interface SandboxOutput {
  compilationError?: string | undefined;
  testcaseResults: TestcaseResult[];
}

export interface TestcaseResult {
  index: number;
  verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "SE";
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  score?: number | undefined;
  feedback?: string | undefined;
}
