import { z } from "zod";

import {
  contestScoringModeSchema,
  ipLockFields,
  ipLockFormFields,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema,
} from "../types";

// `published` schedules the auto-close workflow so sessions hard-stop at `endsAt`.
export const examPublishStatuses = ["draft", "published"] as const;
export const examPublishStatusSchema = z.enum(examPublishStatuses);
export type ExamPublishStatus = z.infer<typeof examPublishStatusSchema>;

// `problemIds` and `summary` are relaxed for draft save — publish path tightens in the domain layer.
const examCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseId: z.string().trim().min(1),
  endsAt: isoDateTimeSchema,
  ...ipLockFields,
  pageLockEnabled: z.boolean().default(false),
  problemIds: z.array(z.string().trim().min(1)).max(32).default([]),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  scoringMode: contestScoringModeSchema.default("point_sum"),
  startsAt: isoDateTimeSchema,
  status: examPublishStatusSchema.default("draft"),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().max(4_000).optional(),
  title: z.string().trim().min(3).max(120),
});

export const examCreateSchema = examCreateBaseSchema.refine(
  (value) => new Date(value.endsAt) > new Date(value.startsAt),
  {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"],
  },
);

export const examUpdateSchema = examCreateBaseSchema.partial();

export type ExamCreate = z.infer<typeof examCreateSchema>;
export type ExamUpdate = z.infer<typeof examUpdateSchema>;

/**
 * Superforms payload for the detail page's Settings tab. Uses
 * `ipLockFormFields` (textarea variant) and lax datetime strings
 * produced by `<input type="datetime-local">`. Server action converts
 * to ISO strings + whitelist array before calling `updateExamRecord`.
 */
export const examSettingsFormSchema = z.object({
  title: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(4_000).default(""),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  scoringMode: contestScoringModeSchema.default("point_sum"),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  submitCooldownSec: z.coerce.number().int().min(0).max(600).default(0),
  pageLockEnabled: z.boolean().default(false),
  ...ipLockFormFields,
});

export type ExamSettingsForm = z.infer<typeof examSettingsFormSchema>;
