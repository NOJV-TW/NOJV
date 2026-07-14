import { z } from "zod";

import {
  contestScoringModeSchema,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema,
  slugSchema,
} from "../types";

export const contestSessionSchema = z
  .object({
    contestId: slugSchema,
    endsAt: isoDateTimeSchema,
    frozenScoreboard: z.boolean(),
    startsAt: isoDateTimeSchema,
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"],
  });

export const contestProblemInputSchema = z.object({
  problemId: z.string().trim().min(1),
  points: z.coerce.number().int().min(1).max(100_000).default(100),
});

export type ContestProblemInput = z.infer<typeof contestProblemInputSchema>;

const contestCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  inviteCode: z.string().trim().max(32).optional(),
  problems: z.array(contestProblemInputSchema).min(1).max(32),
  scoreboardMode: scoreboardModeSchema.default("live"),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  id: slugSchema,
  startsAt: isoDateTimeSchema,
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  penaltyMinutesPerWrong: z.coerce.number().int().min(0).max(1440).default(20),
  summary: z.string().trim().min(8).max(4_000),
  title: z.string().trim().min(3).max(120),
});

export const contestCreateSchema = contestCreateBaseSchema.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"],
  },
);

export const contestUpdateSchema = contestCreateBaseSchema
  .omit({ id: true, frozenAt: true })
  .partial()
  .extend({ frozenAt: isoDateTimeSchema.nullish() })
  .refine(
    (value) =>
      value.startsAt === undefined ||
      value.endsAt === undefined ||
      new Date(value.endsAt) > new Date(value.startsAt),
    {
      message: "endsAt must be later than startsAt",
      path: ["endsAt"],
    },
  );

export type ContestCreate = z.infer<typeof contestCreateSchema>;
export type ContestUpdate = z.infer<typeof contestUpdateSchema>;

export const contestSettingsFormSchema = z.object({
  title: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(4_000).default(""),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  frozenAt: z.string().default(""),
  problems: z
    .array(contestProblemInputSchema)
    .min(1)
    .max(32)
    .default([{ problemId: "", points: 100 }]),
  scoringMode: contestScoringModeSchema.default("problem_count"),
  scoreboardMode: scoreboardModeSchema.default("live"),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  penaltyMinutesPerWrong: z.coerce.number().int().min(0).max(1440).default(20),
});

export type ContestSettingsForm = z.infer<typeof contestSettingsFormSchema>;
