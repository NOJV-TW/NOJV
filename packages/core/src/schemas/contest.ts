import { z } from "zod";

import {
  contestScoringModeSchema,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema,
  slugSchema
} from "../types";

export const contestSessionSchema = z
  .object({
    contestSlug: slugSchema,
    endsAt: isoDateTimeSchema,
    frozenScoreboard: z.boolean(),
    startsAt: isoDateTimeSchema
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"]
  });

// Contest schema — standalone, public/invite-only events only. No
// courseId binding, no proctoring (page lock / IP whitelist / IP
// binding — those live on Exam). No adjustment rules or attempt
// caps — those belong to homework assessments.
const contestCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  inviteCode: z.string().trim().max(32).optional(),
  problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
  scoreboardMode: scoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  slug: slugSchema,
  startsAt: isoDateTimeSchema,
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().min(8).max(4_000),
  title: z.string().trim().min(3).max(120)
});

export const contestCreateSchema = contestCreateBaseSchema.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"]
  }
);

export const contestUpdateSchema = contestCreateBaseSchema.omit({ slug: true }).partial();

export type ContestCreate = z.infer<typeof contestCreateSchema>;
export type ContestUpdate = z.infer<typeof contestUpdateSchema>;
