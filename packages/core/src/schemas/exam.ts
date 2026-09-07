import { z } from "zod";

import {
  examScoringModeSchema,
  ipLockFields,
  ipLockFormFields,
  isoDateTimeSchema,
  languageSchema,
  scoreboardModeSchema,
} from "../types";

import { latePenaltyRuleSchema, refineLateSubmissionWindow } from "./assessment-adjustments";

export const examPublishStatuses = ["draft", "published"] as const;
export const examPublishStatusSchema = z.enum(examPublishStatuses);
export type ExamPublishStatus = z.infer<typeof examPublishStatusSchema>;

const examProblemIdsSchema = z.array(z.string().trim().min(1)).max(32);

const examCreateBaseSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  courseId: z.string().trim().min(1),
  endsAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema.nullish(),
  adjustmentRules: z.array(latePenaltyRuleSchema).max(1).optional(),
  ...ipLockFields,
  pageLockEnabled: z.boolean().default(false),
  problemIds: examProblemIdsSchema.default([]),
  scoreboardMode: scoreboardModeSchema.default("hidden"),
  scoringMode: examScoringModeSchema.default("point_sum"),
  startsAt: isoDateTimeSchema,
  status: examPublishStatusSchema.default("draft"),
  submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
  summary: z.string().trim().max(4_000).optional(),
  title: z.string().trim().min(1).max(120),
});

function refineExamPolicy(
  value: {
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    dueAt?: string | null | undefined;
    scoringMode?: string | undefined;
    adjustmentRules?: unknown[] | undefined;
  },
  ctx: z.RefinementCtx,
) {
  if (value.dueAt != null) {
    if (value.startsAt && new Date(value.dueAt) <= new Date(value.startsAt)) {
      ctx.addIssue({
        code: "custom",
        message: "dueAt must be later than startsAt",
        path: ["dueAt"],
      });
    }
    if (value.endsAt && new Date(value.dueAt) > new Date(value.endsAt)) {
      ctx.addIssue({
        code: "custom",
        message: "endsAt must be later than or equal to dueAt",
        path: ["endsAt"],
      });
    }
  }
  if (value.adjustmentRules?.length && value.scoringMode === "problem_count") {
    ctx.addIssue({
      code: "custom",
      message: "Late penalties require point_sum scoring",
      path: ["adjustmentRules"],
    });
  }
}

export const examCreateSchema = examCreateBaseSchema
  .superRefine(refineExamPolicy)
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "endsAt must be later than startsAt",
    path: ["endsAt"],
  });

export const examUpdateSchema = examCreateBaseSchema
  .partial()
  .extend({
    problemIds: examProblemIdsSchema.optional(),
  })
  .superRefine(refineExamPolicy)
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

export type ExamCreate = z.infer<typeof examCreateSchema>;
export type ExamUpdate = z.infer<typeof examUpdateSchema>;

export const examSettingsFormSchema = z
  .object({
    title: z.string().trim().max(120).default(""),
    summary: z.string().trim().max(4_000).default(""),
    startsAt: z.string().default(""),
    endsAt: z.string().default(""),
    dueAt: z.string().default(""),
    allowLateSubmissions: z.boolean().default(false),
    latePenalty: latePenaltyRuleSchema.nullable().default(null),
    scoringMode: examScoringModeSchema.default("point_sum"),
    scoreboardMode: scoreboardModeSchema.default("hidden"),
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    submitCooldownSec: z.coerce.number().int().min(0).max(3600).default(0),
    pageLockEnabled: z.boolean().default(false),
    ...ipLockFormFields,
  })
  .superRefine((value, ctx) => {
    refineLateSubmissionWindow(value, value.endsAt, ctx, "endsAt");
  });

export type ExamSettingsForm = z.infer<typeof examSettingsFormSchema>;
