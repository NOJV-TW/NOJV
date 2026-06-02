import { z } from "zod";

export const advancedTestcaseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
  runtimeMs: z.number().int().nonnegative().optional(),
  feedback: z.string().max(4_000).optional(),
});

export type AdvancedTestcaseResult = z.infer<typeof advancedTestcaseResultSchema>;

const TOP_VERDICT_ALIASES: Record<string, string> = {
  ac: "accepted",
  wa: "wrong_answer",
  tle: "time_limit_exceeded",
  mle: "memory_limit_exceeded",
  re: "runtime_error",
  ce: "compile_error",
};

export const advancedResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.preprocess(
    (v) => (typeof v === "string" ? (TOP_VERDICT_ALIASES[v.toLowerCase()] ?? v) : v),
    z.enum([
      "accepted",
      "wrong_answer",
      "time_limit_exceeded",
      "memory_limit_exceeded",
      "runtime_error",
      "compile_error",
    ]),
  ),
  feedback: z.string().max(10_000).optional(),
  testcases: z.array(advancedTestcaseResultSchema).max(1_000).optional(),
});

export type AdvancedResult = z.infer<typeof advancedResultSchema>;
