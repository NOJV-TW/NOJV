import { z } from "zod";

import {
  courseJoinTokenKindSchema,
  courseRoleSchema,
  isoDateTimeSchema,
  languageSchema,
  localeCodeSchema,
  slugSchema
} from "../types";
import { adjustmentRulesSchema } from "./assessment-adjustments";

export const courseCreateSchema = z.object({
  description: z.string().trim().min(8).max(2_000),
  locale: localeCodeSchema.default("zh-TW"),
  slug: slugSchema,
  title: z.string().trim().min(3).max(120)
});

export const courseJoinRequestSchema = z.object({
  courseSlug: slugSchema,
  joinTokenKind: courseJoinTokenKindSchema,
  joinToken: z.string().trim().min(4).max(128)
});

export const courseProblemAttachSchema = z.object({
  courseSlug: slugSchema,
  problemId: slugSchema
});

export const manualCourseEnrollmentSchema = z.object({
  courseSlug: slugSchema,
  displayName: z.string().trim().min(2).max(120),
  email: z.email(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  role: courseRoleSchema.default("student")
});

export const assessmentContextSchema = z.object({
  assessmentSlug: slugSchema,
  courseSlug: slugSchema
});

// Homework assessment: no scoreboard, no IP lock, no page lock
// (those were exam-only concerns and now live on Contest).
export const courseAssessmentCreateSchema = z
  .object({
    adjustmentRules: adjustmentRulesSchema.optional(),
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    closesAt: isoDateTimeSchema,
    courseSlug: slugSchema,
    dueAt: isoDateTimeSchema.optional(),
    maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
    opensAt: isoDateTimeSchema,
    problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
    slug: slugSchema,
    summary: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120)
  })
  .superRefine((value, ctx) => {
    const opensAt = new Date(value.opensAt);
    const closesAt = new Date(value.closesAt);

    if (!(opensAt < closesAt)) {
      ctx.addIssue({
        code: "custom",
        message: "closesAt must be later than opensAt",
        path: ["closesAt"]
      });
    }

    if (value.dueAt !== undefined) {
      const dueAt = new Date(value.dueAt);
      if (!(opensAt < dueAt)) {
        ctx.addIssue({
          code: "custom",
          message: "dueAt must be later than opensAt",
          path: ["dueAt"]
        });
      }
      if (!(dueAt <= closesAt)) {
        ctx.addIssue({
          code: "custom",
          message: "closesAt must be later than or equal to dueAt",
          path: ["closesAt"]
        });
      }
    }
  });

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type CourseAssessmentCreate = z.infer<typeof courseAssessmentCreateSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseJoinRequest = z.infer<typeof courseJoinRequestSchema>;
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
