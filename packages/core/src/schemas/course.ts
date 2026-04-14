import { z } from "zod";

import { courseRoleSchema, isoDateTimeSchema, languageSchema, slugSchema } from "../types";
import { adjustmentRulesSchema } from "./assessment-adjustments";

// Course creation takes only title + description. The post-redesign create
// flow no longer exposes slug / visibility / locale / semester to users;
// the new URL key is the cuid primary key.
export const courseCreateSchema = z.object({
  description: z.string().trim().min(8).max(2_000),
  title: z.string().trim().min(3).max(120)
});

export const courseProblemAttachSchema = z.object({
  courseId: z.string().trim().min(1),
  problemId: slugSchema
});

export const manualCourseEnrollmentSchema = z.object({
  courseId: z.string().trim().min(1),
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

// Assessments are identified by (courseId, assessmentSlug). The slug
// carrier used to be the course slug; now it's the course cuid.
export const assessmentContextSchema = z.object({
  assessmentSlug: slugSchema,
  courseId: z.string().trim().min(1)
});

// Homework assessment: no scoreboard, no IP lock, no page lock
// (those were exam-only concerns and now live on Contest).
export const courseAssessmentCreateSchema = z
  .object({
    adjustmentRules: adjustmentRulesSchema.optional(),
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    closesAt: isoDateTimeSchema,
    courseId: z.string().trim().min(1),
    dueAt: isoDateTimeSchema.optional(),
    maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
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
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
