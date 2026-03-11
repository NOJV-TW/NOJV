import { z } from "zod";

export const supportedLanguages = [
  "c",
  "cpp",
  "go",
  "java",
  "javascript",
  "python",
  "rust",
  "typescript"
] as const;

export const platformRoles = ["admin", "teacher", "student"] as const;
export const courseRoles = ["teacher", "ta", "student"] as const;
export const effectiveCourseRoles = ["admin", "teacher", "ta", "student"] as const;
export const courseJoinMethods = ["qr_code", "join_code", "manual_invite"] as const;
export const problemVisibilities = ["public", "private"] as const;
export const courseAssessmentTypes = ["assignment", "exam"] as const;
export const assessmentScoreboardModes = ["hidden", "live", "frozen"] as const;
export const courseMembershipStatuses = ["active", "invited", "pending", "removed"] as const;
export const submissionModes = ["practice", "contest", "assignment", "exam"] as const;
export const judgeTypes = ["standard", "checker", "interactive"] as const;
export const submissionTypes = ["function", "full_source"] as const;
export const submissionVerdicts = [
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded"
] as const;
export const submissionOperationStatuses = [
  "queued",
  "running",
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded"
] as const;

export const localeCodes = ["en", "zh-TW"] as const;

export const platformRoleSchema = z.enum(platformRoles);
export const courseRoleSchema = z.enum(courseRoles);
export const effectiveCourseRoleSchema = z.enum(effectiveCourseRoles);
export const courseJoinMethodSchema = z.enum(courseJoinMethods);
export const problemVisibilitySchema = z.enum(problemVisibilities);
export const courseAssessmentTypeSchema = z.enum(courseAssessmentTypes);
export const assessmentScoreboardModeSchema = z.enum(assessmentScoreboardModes);
export const courseMembershipStatusSchema = z.enum(courseMembershipStatuses);
export const languageSchema = z.enum(supportedLanguages);
export const submissionModeSchema = z.enum(submissionModes);
export const judgeTypeSchema = z.enum(judgeTypes);
export const submissionTypeSchema = z.enum(submissionTypes);
export const localeCodeSchema = z.enum(localeCodes);
export const submissionVerdictSchema = z.enum(submissionVerdicts);
export const submissionOperationStatusSchema = z.enum(submissionOperationStatuses);
const slugSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const isoDateTimeSchema = z.iso.datetime();
const sourceCodeSchema = z.string().trim().min(1).max(100_000);
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

export const problemTemplateSchema = z.object({
  driverCode: z.string().min(1).max(200_000),
  insertionMarker: z.string().min(1).max(200).default("// __USER_CODE__"),
  language: languageSchema,
  templateCode: z.string().min(1).max(100_000)
});

export const problemCreateSchema = z.object({
  checkerScript: z.string().max(200_000).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  inputFormat: z.string().trim().max(4_000).default(""),
  interactorScript: z.string().max(200_000).optional(),
  judgeType: judgeTypeSchema.default("standard"),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  outputFormat: z.string().trim().max(4_000).default(""),
  slug: slugSchema,
  statement: z.string().trim().min(16).max(12_000),
  submissionType: submissionTypeSchema.default("full_source"),
  summary: z.string().trim().max(2_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  templates: z.array(problemTemplateSchema).max(10).default([]),
  timeLimitMs: z.coerce.number().int().min(100).max(30_000).default(1_000),
  title: z.string().trim().min(3).max(120),
  visibility: problemVisibilitySchema
});

export const problemUpdateSchema = problemCreateSchema.omit({ slug: true }).partial();

export const problemTestcaseCaseSchema = z.object({
  expectedStdout: z.string().max(200_000),
  stdin: z.string().max(200_000)
});

export const problemJudgeTestcaseSchema = z.object({
  expectedStdout: z.string().max(200_000).optional(),
  id: z.string().trim().min(1),
  inputFiles: z.record(z.string(), z.string()).optional(),
  isHidden: z.boolean(),
  stdin: z.string().max(200_000),
  weight: z.coerce.number().int().min(1).max(100)
});

export const problemTestcaseSetCreateSchema = z.object({
  cases: z.array(problemTestcaseCaseSchema).min(1).max(256),
  isHidden: z.boolean(),
  name: z.string().trim().min(1).max(120),
  weight: z.coerce.number().int().min(1).max(100).default(1)
});

export const courseProblemAttachSchema = z.object({
  courseSlug: slugSchema,
  problemSlug: slugSchema
});

export const manualCourseEnrollmentSchema = z.object({
  courseSlug: slugSchema,
  displayName: z.string().trim().min(2).max(120),
  email: z.email(),
  handle: z
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

export const submissionDraftSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    contestSlug: slugSchema.optional(),
    language: languageSchema,
    mode: submissionModeSchema,
    problemSlug: slugSchema,
    sampleOnly: z.boolean().optional(),
    sourceCode: sourceCodeSchema
  })
  .superRefine((value, ctx) => {
    if (value.mode === "contest" && !value.contestSlug) {
      ctx.addIssue({
        code: "custom",
        message: "contestSlug is required for contest submissions",
        path: ["contestSlug"]
      });
    }

    if (value.mode === "exam") {
      if (!value.assessment) {
        ctx.addIssue({
          code: "custom",
          message: "assessment is required for exam submissions",
          path: ["assessment"]
        });
      } else if (value.assessment.kind !== "exam") {
        ctx.addIssue({
          code: "custom",
          message: "assessment.kind must be exam for exam submissions",
          path: ["assessment", "kind"]
        });
      }
    }

    if (value.mode === "assignment" && value.assessment?.kind === "exam") {
      ctx.addIssue({
        code: "custom",
        message: "assignment submissions cannot target exam assessments",
        path: ["assessment", "kind"]
      });
    }
  });

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

export const testcaseResultItemSchema = z.object({
  index: z.number().int().nonnegative(),
  passed: z.boolean(),
  stdout: z.string(),
  timeMs: z.number().int().nonnegative()
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(testcaseResultItemSchema).optional(),
  feedback: z.string().min(1),
  runtimeMs: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  verdict: submissionVerdictSchema
});

export const submissionDispatchResponseSchema = z.object({
  pollUrl: z.string().min(1),
  status: submissionOperationStatusSchema,
  submissionId: z.string().min(1)
});

export const submissionOperationSchema = z.object({
  result: submissionResultSchema.nullable(),
  status: submissionOperationStatusSchema,
  submissionId: z.string().min(1)
});

export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  slug: slugSchema,
  title: z.string().min(1),
  totalSubmissions: z.number().int().nonnegative()
});

export const courseAssessmentSummarySchema = z.object({
  closesAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  opensAt: isoDateTimeSchema,
  scoreboardMode: assessmentScoreboardModeSchema,
  slug: slugSchema,
  title: z.string().min(1),
  type: courseAssessmentTypeSchema
});

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type CourseAssessmentCreate = z.infer<typeof courseAssessmentCreateSchema>;
export type ContestSession = z.infer<typeof contestSessionSchema>;
export type CourseAssessmentSummary = z.infer<typeof courseAssessmentSummarySchema>;
export type CourseAssessmentType = z.infer<typeof courseAssessmentTypeSchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseJoinMethod = z.infer<typeof courseJoinMethodSchema>;
export type CourseJoinRequest = z.infer<typeof courseJoinRequestSchema>;
export type CourseMembershipStatus = z.infer<typeof courseMembershipStatusSchema>;
export type CourseProblemAttach = z.infer<typeof courseProblemAttachSchema>;
export type CourseRole = z.infer<typeof courseRoleSchema>;
export type EffectiveCourseRole = z.infer<typeof effectiveCourseRoleSchema>;
export type JudgeType = z.infer<typeof judgeTypeSchema>;
export type Language = z.infer<typeof languageSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ProblemCreate = z.infer<typeof problemCreateSchema>;
export type ProblemUpdate = z.infer<typeof problemUpdateSchema>;
export type ProblemTemplate = z.infer<typeof problemTemplateSchema>;
export type ProblemTestcaseCase = z.infer<typeof problemTestcaseCaseSchema>;
export type ProblemJudgeTestcase = z.infer<typeof problemJudgeTestcaseSchema>;
export type ProblemTestcaseSetCreate = z.infer<typeof problemTestcaseSetCreateSchema>;
export type ProblemOverview = z.infer<typeof problemOverviewSchema>;
export type ProblemVisibility = z.infer<typeof problemVisibilitySchema>;
export type SubmissionType = z.infer<typeof submissionTypeSchema>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type SubmissionDispatchResponse = z.infer<typeof submissionDispatchResponseSchema>;
export type SubmissionMode = z.infer<typeof submissionModeSchema>;
export type SubmissionOperation = z.infer<typeof submissionOperationSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;

interface EditorSessionIdentifierInput {
  assessmentSlug?: string | undefined;
  contestSlug?: string | undefined;
  courseSlug?: string | undefined;
  problemSlug: string;
}

function sanitizeSessionSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "unknown";
}

function joinSessionSegments(prefix: string, segments: string[]) {
  const joined = [prefix, ...segments.map(sanitizeSessionSegment)].join("_");

  return joined.length <= 128 ? joined : joined.slice(0, 128);
}

export function buildEditorSessionId(input: EditorSessionIdentifierInput) {
  if (input.contestSlug) {
    return joinSessionSegments("editor", [input.problemSlug, "contest", input.contestSlug]);
  }

  if (input.courseSlug && input.assessmentSlug) {
    return joinSessionSegments("editor", [
      input.problemSlug,
      input.courseSlug,
      input.assessmentSlug
    ]);
  }

  return joinSessionSegments("editor", [input.problemSlug, "practice"]);
}
