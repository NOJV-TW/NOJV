import {
  contestScoringModeSchema,
  ipLockFormFields,
  languageSchema,
  scoreboardModeSchema,
  slugSchema
} from "@nojv/core";
import { z } from "zod";

// Contest form schema — `maxAttempts` and `adjustmentRules` live only
// on course homework assessments; the contest form does not collect
// them.
export const contestFormSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseSlug: slugSchema.optional(),
  endsAt: z.string().min(1),
  frozenAt: z.string().optional(),
  inviteCode: z.string().max(32).optional(),
  ...ipLockFormFields,
  pageLockEnabled: z.boolean().default(false),
  problemIdsText: z.string().min(1),
  scoreboardMode: scoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  slug: slugSchema,
  startsAt: z.string().min(1),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().min(8).max(4_000),
  title: z.string().min(3).max(120)
});
