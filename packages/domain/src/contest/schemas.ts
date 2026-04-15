import {
  contestScoringModeSchema,
  languageSchema,
  scoreboardModeSchema,
  slugSchema
} from "@nojv/core";
import { z } from "zod";

// Standalone contests only: no courseId, no proctoring, no attempt caps / adjustment rules.
export const contestFormSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  endsAt: z.string().min(1),
  frozenAt: z.string().optional(),
  inviteCode: z.string().max(32).optional(),
  problemIdsText: z.string().min(1),
  scoreboardMode: scoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  slug: slugSchema,
  startsAt: z.string().min(1),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().min(8).max(4_000),
  title: z.string().min(3).max(120)
});
