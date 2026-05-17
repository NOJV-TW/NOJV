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

// Title for a copied course — same bounds as a course title. The copy
// dialog pre-fills a `"<title> (copy)"` suggestion but the teacher may
// replace it freely.
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

// Assessments are identified by (courseId, assessmentId). The id
// carrier used to be the course slug; now it's the course cuid.
export const assessmentContextSchema = z.object({
  assessmentId: slugSchema,
  courseId: z.string().trim().min(1),
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
    id: slugSchema,
    summary: z.string().trim().min(8).max(2_000),
    title: z.string().trim().min(3).max(120),
  })
  .superRefine((value, ctx) => {
    const opensAt = new Date(value.opensAt);
    const closesAt = new Date(value.closesAt);

    if (!(opensAt < closesAt)) {
      ctx.addIssue({
        code: "custom",
        message: "closesAt must be later than opensAt",
        path: ["closesAt"],
      });
    }

    if (value.dueAt !== undefined) {
      const dueAt = new Date(value.dueAt);
      if (!(opensAt < dueAt)) {
        ctx.addIssue({
          code: "custom",
          message: "dueAt must be later than opensAt",
          path: ["dueAt"],
        });
      }
      if (!(dueAt <= closesAt)) {
        ctx.addIssue({
          code: "custom",
          message: "closesAt must be later than or equal to dueAt",
          path: ["closesAt"],
        });
      }
    }
  });

// `problemIds` allows 0 entries so a teacher can stand up a draft for a TA to fill in later.
export const courseAssignmentFormSchema = z
  .object({
    allowedLanguages: z.array(languageSchema).max(8).default([]),
    closesAt: z.string().trim().min(1),
    courseId: z.string().trim().min(1),
    dueAt: z.string().trim().min(1),
    latePenalty: adjustmentRuleSchema.nullable().default(null),
    maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
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

    if (!(opensAt < dueAt)) {
      ctx.addIssue({
        code: "custom",
        message: "dueAt must be later than opensAt",
        path: ["dueAt"],
      });
    }
    if (!(dueAt <= closesAt)) {
      ctx.addIssue({
        code: "custom",
        message: "closesAt must be later than or equal to dueAt",
        path: ["closesAt"],
      });
    }
  });

// Domain-facing partial update payload. Every field is optional so
// callers can send only the fields they actually want to change. The
// domain layer enforces status-aware field-level locks (see
// `packages/domain/src/assessment/mutations.ts`).
export const courseAssessmentUpdateSchema = z.object({
  allowedLanguages: z.array(languageSchema).max(8).optional(),
  closesAt: isoDateTimeSchema.optional(),
  dueAt: isoDateTimeSchema.nullish(),
  maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
  opensAt: isoDateTimeSchema.optional(),
  problemIds: z.array(z.string().trim().min(1)).max(32).optional(),
  problemOrdinals: z
    .array(
      z.object({
        problemId: z.string().trim().min(1),
        points: z.coerce.number().int().min(0).max(10_000),
      }),
    )
    .max(32)
    .optional(),
  adjustmentRules: adjustmentRulesSchema.optional(),
  summary: z.string().trim().max(2_000).optional(),
  title: z.string().trim().min(3).max(120).optional(),
});

// Superforms-facing schema used by the assignment settings tab. Strings
// come out of <input type="datetime-local"> as local-time strings rather
// than ISO — we accept any non-empty string and normalise to ISO in the
// server action before calling the domain update.
export const assessmentSettingsFormSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(2_000).default(""),
  opensAt: z.string().trim().min(1),
  dueAt: z.string().trim().default(""),
  closesAt: z.string().trim().min(1),
  allowedLanguages: z.array(languageSchema).max(8).default([]),
  maxAttemptsPerDay: z.coerce.number().int().min(1).max(999).nullish(),
  latePenalty: adjustmentRuleSchema.nullable().default(null),
});

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type AssessmentSettingsFormData = z.infer<typeof assessmentSettingsFormSchema>;
export type CourseAssessmentCreate = z.infer<typeof courseAssessmentCreateSchema>;
export type CourseAssessmentUpdate = z.infer<typeof courseAssessmentUpdateSchema>;
export type CourseAssignmentFormData = z.infer<typeof courseAssignmentFormSchema>;
export type CopyCourse = z.infer<typeof copyCourseSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type CourseUpdate = z.infer<typeof courseUpdateSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
