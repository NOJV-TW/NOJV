import { z } from "zod";

// Per-testcase result reported by the TA's container.
export const advancedTestcaseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  runtimeMs: z.number().int().nonnegative().optional(),
  feedback: z.string().max(4_000).optional(),
});

export type AdvancedTestcaseResult = z.infer<typeof advancedTestcaseResultSchema>;

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
});

export type AdvancedResult = z.infer<typeof advancedResultSchema>;
