import { z } from "zod";

import {
  assessmentScoreboardModeSchema,
  courseAssessmentTypeSchema,
  courseJoinMethodSchema,
  courseRoleSchema,
  isoDateTimeSchema,
  localeCodeSchema,
  slugSchema
} from "../types";

export const courseCreateSchema = z.object({
  description: z.string().trim().min(8).max(2_000),
  locale: localeCodeSchema.default("zh-TW"),
  slug: slugSchema,
  title: z.string().trim().min(3).max(120)
});

export const courseJoinRequestSchema = z.object({
  courseSlug: slugSchema,
  joinMethod: courseJoinMethodSchema,
  joinToken: z.string().trim().min(4).max(128)
});

export const courseProblemAttachSchema = z.object({
  courseSlug: slugSchema,
  problemSlug: slugSchema
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
  courseSlug: slugSchema,
  kind: courseAssessmentTypeSchema
});

export const courseAssessmentCreateSchema = z
  .object({
    closesAt: isoDateTimeSchema,
    courseSlug: slugSchema,
    dueAt: isoDateTimeSchema,
    ipLockEnabled: z.boolean().default(false),
    maxAttempts: z.coerce.number().int().min(1).max(999).nullish(),
    opensAt: isoDateTimeSchema,
    pageLockEnabled: z.boolean().default(false),
    problemSlugs: z.array(slugSchema).min(1).max(32),
    scoreboardMode: assessmentScoreboardModeSchema.optional(),
    slug: slugSchema,
    summary: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120),
    type: courseAssessmentTypeSchema
  })
  .superRefine((value, ctx) => {
    const opensAt = new Date(value.opensAt);
    const dueAt = new Date(value.dueAt);
    const closesAt = new Date(value.closesAt);

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
  });

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type CourseAssessmentCreate = z.infer<typeof courseAssessmentCreateSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseJoinRequest = z.infer<typeof courseJoinRequestSchema>;
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
