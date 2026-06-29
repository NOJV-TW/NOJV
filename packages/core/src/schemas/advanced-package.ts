import { z } from "zod";

import { advancedCanonicalVerdictSchema, MAX_ADVANCED_TOTAL_TIME_MS } from "./advanced-mode";
import { safeRelativePath } from "./path";
import { requiredPathsSchema } from "./required-paths";

const advancedPackageNetworkSchema = z
  .object({
    mode: z.enum(["none", "allowlist", "service"]).default("none"),
    allowlist: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "allowlist" && value.allowlist.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allowlist"],
        message: "allowlist must be non-empty when network.mode is allowlist",
      });
    }
    if (value.mode !== "allowlist" && value.allowlist.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["allowlist"],
        message: "allowlist is only allowed when network.mode is allowlist",
      });
    }
  });

const advancedPackageSampleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    submission: safeRelativePath,
    expect: z
      .object({
        verdict: advancedCanonicalVerdictSchema,
        score: z.number().int().min(0).max(100_000),
      })
      .strict(),
  })
  .strict();

export const advancedPackageManifestSchema = z
  .object({
    version: z.literal(1),
    scoring: z
      .object({
        maxScore: z.coerce.number().int().min(1).max(100_000),
      })
      .strict(),
    resources: z
      .object({
        timeLimitMs: z.coerce.number().int().min(1_000).max(MAX_ADVANCED_TOTAL_TIME_MS),
        memoryLimitMb: z.coerce.number().int().min(16).max(4_096),
      })
      .strict(),
    student: z
      .object({
        requiredPaths: requiredPathsSchema.default([]),
      })
      .strict()
      .default({ requiredPaths: [] }),
    network: advancedPackageNetworkSchema.default({ mode: "none", allowlist: [] }),
    samples: z.array(advancedPackageSampleSchema).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, sample] of value.samples.entries()) {
      if (sample.expect.score > value.scoring.maxScore) {
        ctx.addIssue({
          code: "custom",
          path: ["samples", index, "expect", "score"],
          message: "sample expected score must not exceed scoring.maxScore",
        });
      }
      if (
        sample.expect.verdict === "accepted" &&
        sample.expect.score !== value.scoring.maxScore
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["samples", index, "expect", "score"],
          message: "accepted sample must expect scoring.maxScore",
        });
      }
      if (
        sample.expect.score === value.scoring.maxScore &&
        sample.expect.verdict !== "accepted"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["samples", index, "expect", "verdict"],
          message: "max-score sample must expect accepted",
        });
      }
    }
  });

export type AdvancedPackageManifest = z.infer<typeof advancedPackageManifestSchema>;
