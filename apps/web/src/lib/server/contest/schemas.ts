import {
  assessmentScoreboardModeSchema,
  contestScoringModeSchema,
  ipLockFormFields,
  languageSchema,
  slugSchema
} from "@nojv/core";
import { z } from "zod";

export const contestFormSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseSlug: slugSchema.optional(),
  endsAt: z.string().min(1),
  frozenAt: z.string().optional(),
  inviteCode: z.string().max(32).optional(),
  ...ipLockFormFields,
  maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
  pageLockEnabled: z.boolean().default(false),
  problemSlugsText: z.string().min(1),
  scoreboardMode: assessmentScoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("icpc"),
  slug: slugSchema,
  startsAt: z.string().min(1),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().min(8).max(4_000),
  title: z.string().min(3).max(120)
});
