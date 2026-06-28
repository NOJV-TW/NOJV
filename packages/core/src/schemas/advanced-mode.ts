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
  score: z.number().min(0).max(100_000),
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

export const imageSourceSchema = z.enum(["registry", "tarball"]);

export const imageRefSchema = z.object({
  imageRef: z.string().min(1).max(500),
  imageSource: imageSourceSchema,
});

export type ImageRef = z.infer<typeof imageRefSchema>;

const networkSchema = z
  .object({
    mode: z.enum(["none", "allowlist", "service"]).default("none"),
    allowlist: z.array(z.string().min(1)).optional(),
    service: imageRefSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "allowlist") {
      if (!value.allowlist || value.allowlist.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["allowlist"],
          message: "allowlist must be a non-empty array when mode is 'allowlist'",
        });
      }
      if (value.service) {
        ctx.addIssue({
          code: "custom",
          path: ["service"],
          message: "service must be absent when mode is 'allowlist'",
        });
      }
    } else if (value.mode === "service") {
      if (!value.service) {
        ctx.addIssue({
          code: "custom",
          path: ["service"],
          message: "service must be present when mode is 'service'",
        });
      }
      if (value.allowlist) {
        ctx.addIssue({
          code: "custom",
          path: ["allowlist"],
          message: "allowlist must be absent when mode is 'service'",
        });
      }
    } else {
      if (value.allowlist) {
        ctx.addIssue({
          code: "custom",
          path: ["allowlist"],
          message: "allowlist must be absent when mode is 'none'",
        });
      }
      if (value.service) {
        ctx.addIssue({
          code: "custom",
          path: ["service"],
          message: "service must be absent when mode is 'none'",
        });
      }
    }
  });

export const advancedConfigSchema = z.object({
  run: imageRefSchema,
  grade: imageRefSchema,
  network: networkSchema.default({ mode: "none" }),
  maxScore: z.coerce.number().int().min(1).max(100_000).default(100),
});

export type AdvancedConfig = z.infer<typeof advancedConfigSchema>;

export const MAX_ADVANCED_TOTAL_TIME_MS = 120_000;
