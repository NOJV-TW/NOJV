import { z } from "zod";

import {
  contestScoringModeSchema,
  ipLockFields,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema
} from "../types";

// `draft` — visible to course teachers/TAs only, no auto-close workflow.
// `published` — visible to enrolled students, schedules the auto-close
// timer so sessions hard-stop at `endsAt`.
export const examPublishStatuses = ["draft", "published"] as const;
export const examPublishStatusSchema = z.enum(examPublishStatuses);
export type ExamPublishStatus = z.infer<typeof examPublishStatusSchema>;

// Exam is always course-embedded — `courseId` is mandatory. Proctoring
// fields (page lock, IP whitelist, IP binding) live here, not on Contest.
// Exam reuses the shared contest scoring mode enum (problem_count /
// point_sum) since the scoring layer is now hoisted to `@nojv/domain`'s
// `scoring/` module.
//
// `problemIds` may be empty and `summary` is optional — the Create Exam
// flow supports "save draft" so a teacher can stub out a shell and let a
// TA fill in problems / description later. The UI/domain layer enforces
// stricter rules on the publish path if needed.
const examCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseId: z.string().trim().min(1),
  endsAt: isoDateTimeSchema,
  frozenAt: isoDateTimeSchema.optional(),
  ...ipLockFields,
  pageLockEnabled: z.boolean().default(false),
  problemIds: z.array(z.string().trim().min(1)).max(32).default([]),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  scoringMode: contestScoringModeSchema.default("point_sum"),
  startsAt: isoDateTimeSchema,
  status: examPublishStatusSchema.default("draft"),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().max(4_000).optional(),
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
