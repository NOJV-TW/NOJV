import { z } from "zod";

import {
  contestScoringModeSchema,
  ipLockFields,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema
} from "../types";

// Exam is always course-embedded — `courseId` is mandatory. Proctoring
// fields (page lock, IP whitelist, IP binding) live here, not on Contest.
// Exam reuses the shared contest scoring mode enum (problem_count /
// point_sum) since the scoring layer is now hoisted to `@nojv/domain`'s
// `scoring/` module.
const examCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseId: z.string().trim().min(1),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  ...ipLockFields,
  pageLockEnabled: z.boolean().default(false),
  problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  scoringMode: contestScoringModeSchema.default("point_sum"),
  startsAt: isoDateTimeSchema,
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().min(8).max(4_000),
  title: z.string().trim().min(3).max(120)
});

export const examCreateSchema = examCreateBaseSchema.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"]
  }
);

export const examUpdateSchema = examCreateBaseSchema.partial();

export type ExamCreate = z.infer<typeof examCreateSchema>;
export type ExamUpdate = z.infer<typeof examUpdateSchema>;
