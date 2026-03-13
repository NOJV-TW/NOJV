import { z } from "zod";

import { contestScoringModeSchema, isoDateTimeSchema, slugSchema } from "../types";

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

const contestCreateBaseSchema = z.object({
  courseSlug: slugSchema.optional(),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  problemSlugs: z.array(slugSchema).min(1).max(32),
  scoringMode: contestScoringModeSchema.default("icpc"),
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
