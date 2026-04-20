import { z } from "zod";

// Per-testcase result reported by the TA's container.
export const advancedTestcaseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  runtimeMs: z.number().int().nonnegative().optional(),
  feedback: z.string().max(4_000).optional(),
});

export type AdvancedTestcaseResult = z.infer<typeof advancedTestcaseResultSchema>;

// Per-subtask result.
export const advancedSubtaskResultSchema = z.object({
  name: z.string().max(200),
  score: z.number().min(0).max(100),
  passed: z.boolean(),
});

export type AdvancedSubtaskResult = z.infer<typeof advancedSubtaskResultSchema>;

// The full result.json written by the TA's container.
export const advancedResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum([
    "accepted",
    "wrong_answer",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "runtime_error",
    "compile_error",
  ]),
  feedback: z.string().max(10_000).optional(),
  testcases: z.array(advancedTestcaseResultSchema).max(1_000).optional(),
  subtasks: z.array(advancedSubtaskResultSchema).max(100).optional(),
});

export type AdvancedResult = z.infer<typeof advancedResultSchema>;

// Advanced-mode image configuration (stored on Problem.judgeConfig or as Problem columns).
export const advancedImageConfigSchema = z.object({
  source: z.enum(["registry", "tarball"]),
  ref: z.string().min(1).max(500),
  resourceLimits: z
    .object({
      totalTimeMs: z.number().int().min(1_000).max(300_000).default(30_000),
      memoryMb: z.number().int().min(16).max(4096).default(1_024),
    })
    .optional(),
});

export type AdvancedImageConfig = z.infer<typeof advancedImageConfigSchema>;
