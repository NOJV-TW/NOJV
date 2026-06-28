import { z } from "zod";

import { courseRoleSchema, isoDateTimeSchema, languageSchema, slugSchema } from "../types";
import { adjustmentRuleSchema, adjustmentRulesSchema } from "./assessment-adjustments";

const academicTermFields = {
  academicYear: z.coerce.number().int().min(100).max(999).nullish(),
  semester: z.coerce.number().int().min(1).max(3).nullish(),
};

function refineAcademicTerm(
  value: { academicYear?: number | null | undefined; semester?: number | null | undefined },
  ctx: z.RefinementCtx,
) {
  const hasYear = value.academicYear != null;
  const hasSemester = value.semester != null;
  if (hasYear !== hasSemester) {
    ctx.addIssue({
      code: "custom",
      message: "academicYear and semester must both be provided or both be empty",
      path: [hasYear ? "semester" : "academicYear"],
    });
  }
}

export const courseCreateSchema = z
  .object({
    description: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120),
    ...academicTermFields,
  })
  .superRefine(refineAcademicTerm);

export const courseUpdateSchema = z
  .object({
    description: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120),
    ...academicTermFields,
  })
  .superRefine(refineAcademicTerm);

export const courseProblemAttachSchema = z.object({
  courseId: z.string().trim().min(1),
  problemId: slugSchema,
});

export const copyCourseSchema = z.object({
  newTitle: z.string().trim().min(3).max(120),
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
  role: courseRoleSchema.default("student"),
});

export const assessmentContextSchema = z.object({
  assessmentId: slugSchema,
  courseId: z.string().trim().min(1),
});

export const assessmentCreateSchema = z
  .object({
    adjustmentRules: adjustmentRulesSchema.optional(),
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    closesAt: isoDateTimeSchema,
    courseId: z.string().trim().min(1),
    dueAt: isoDateTimeSchema.optional(),
    maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
    attemptResetMinuteOfDay: z.coerce.number().int().min(0).max(1439).nullish(),
    opensAt: isoDateTimeSchema,
    problemIds: z.array(z.string().trim().min(1)).min(1).max(32),
    id: slugSchema,
    summary: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120),
  })
  .superRefine((value, ctx) => {
    const opensAt = new Date(value.opensAt);
    const closesAt = new Date(value.closesAt);

    if (opensAt >= closesAt) {
      ctx.addIssue({
        code: "custom",
        message: "closesAt must be later than opensAt",
        path: ["closesAt"],
      });
    }

    if (value.dueAt !== undefined) {
      const dueAt = new Date(value.dueAt);
      if (opensAt >= dueAt) {
        ctx.addIssue({
          code: "custom",
          message: "dueAt must be later than opensAt",
          path: ["dueAt"],
        });
      }
      if (dueAt > closesAt) {
        ctx.addIssue({
          code: "custom",
          message: "closesAt must be later than or equal to dueAt",
          path: ["closesAt"],
        });
      }
    }
  });

export const courseAssignmentFormSchema = z
  .object({
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    closesAt: z.string().trim().min(1),
    courseId: z.string().trim().min(1),
    dueAt: z.string().trim().min(1),
    latePenalty: adjustmentRuleSchema.nullable().default(null),
    maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
    attemptResetMinuteOfDay: z.coerce.number().int().min(0).max(1439).nullish(),
    opensAt: z.string().trim().min(1),
    problemIds: z.array(z.string().trim().min(1)).max(64).default([]),
    status: z.enum(["draft", "published"]).default("draft"),
    title: z.string().trim().min(3).max(120),
  })
  .superRefine((value, ctx) => {
    const opensAt = new Date(value.opensAt);
    const closesAt = new Date(value.closesAt);
    const dueAt = new Date(value.dueAt);

    if (Number.isNaN(opensAt.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid opensAt", path: ["opensAt"] });
      return;
    }
    if (Number.isNaN(dueAt.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid dueAt", path: ["dueAt"] });
      return;
    }
    if (Number.isNaN(closesAt.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid closesAt", path: ["closesAt"] });
      return;
    }

    if (opensAt >= dueAt) {
      ctx.addIssue({
        code: "custom",
        message: "dueAt must be later than opensAt",
        path: ["dueAt"],
      });
    }
    if (dueAt > closesAt) {
      ctx.addIssue({
        code: "custom",
        message: "closesAt must be later than or equal to dueAt",
        path: ["closesAt"],
      });
    }
  });

export const assessmentUpdateSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).optional(),
  closesAt: isoDateTimeSchema.optional(),
  dueAt: isoDateTimeSchema.nullish(),
  maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
  attemptResetMinuteOfDay: z.coerce.number().int().min(0).max(1439).nullish(),
  opensAt: isoDateTimeSchema.optional(),
  problemIds: z.array(z.string().trim().min(1)).max(32).optional(),
  adjustmentRules: adjustmentRulesSchema.optional(),
  summary: z.string().trim().max(2_000).optional(),
  title: z.string().trim().min(3).max(120).optional(),
});

export const assessmentSettingsFormSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(2_000).default(""),
  opensAt: z.string().trim().min(1),
  dueAt: z.string().trim().default(""),
  closesAt: z.string().trim().min(1),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
  attemptResetMinuteOfDay: z.coerce.number().int().min(0).max(1439).nullish(),
  latePenalty: adjustmentRuleSchema.nullable().default(null),
});

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type AssessmentSettingsFormData = z.infer<typeof assessmentSettingsFormSchema>;
export type AssessmentCreate = z.infer<typeof assessmentCreateSchema>;
export type AssessmentUpdate = z.infer<typeof assessmentUpdateSchema>;
export type CourseAssignmentFormData = z.infer<typeof courseAssignmentFormSchema>;
export type CopyCourse = z.infer<typeof copyCourseSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type CourseUpdate = z.infer<typeof courseUpdateSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
