import { z } from "zod";

export const supportedLanguages = [
  "c",
  "cpp",
  "java",
  "javascript",
  "python",
  "rust",
  "typescript"
] as const;

export const platformRoles = ["admin", "teacher", "ta", "student"] as const;
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
export const workspaceModes = ["practice", "assignment", "contest", "exam"] as const;
export const cheatingSignalTypes = [
  "focus_loss",
  "paste_burst",
  "ip_change",
  "similarity_match",
  "shell_policy_violation",
  "concurrent_session"
] as const;
export const integritySignalSources = [
  "problem_editor",
  "workspace_terminal",
  "contest_workspace"
] as const;
export const workspaceRunStatuses = ["succeeded", "failed", "blocked", "timed_out"] as const;
export const integrityRiskLevels = ["low", "medium", "high"] as const;
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
export const workspaceOperationStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "timed_out"
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
export const workspaceModeSchema = z.enum(workspaceModes);
export const judgeTypeSchema = z.enum(judgeTypes);
export const submissionTypeSchema = z.enum(submissionTypes);
export const cheatingSignalTypeSchema = z.enum(cheatingSignalTypes);
export const integritySignalSourceSchema = z.enum(integritySignalSources);
export const localeCodeSchema = z.enum(localeCodes);
export const workspaceRunStatusSchema = z.enum(workspaceRunStatuses);
export const integrityRiskLevelSchema = z.enum(integrityRiskLevels);
export const submissionVerdictSchema = z.enum(submissionVerdicts);
export const submissionOperationStatusSchema = z.enum(submissionOperationStatuses);
export const workspaceOperationStatusSchema = z.enum(workspaceOperationStatuses);
export const actorIdentitySchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  email: z.email(),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  platformRole: platformRoleSchema,
  userId: z.string().trim().min(3).max(64)
});

const actorSearchParamKeys = {
  displayName: "actorName",
  email: "actorEmail",
  handle: "actorHandle",
  platformRole: "actorRole",
  userId: "actorId"
} as const;

export const localActorPresets = {
  admin: actorIdentitySchema.parse({
    displayName: "Ops Admin",
    email: "ops.admin@nojv.local",
    handle: "ops_admin",
    platformRole: "admin",
    userId: "usr_admin_ops"
  }),
  student: actorIdentitySchema.parse({
    displayName: "Alice Huang",
    email: "alice.huang@nojv.local",
    handle: "stu_alice",
    platformRole: "student",
    userId: "usr_student_alice"
  }),
  ta: actorIdentitySchema.parse({
    displayName: "Ren Wu",
    email: "ren.wu@nojv.local",
    handle: "ta_ren",
    platformRole: "ta",
    userId: "usr_ta_ren"
  }),
  teacher: actorIdentitySchema.parse({
    displayName: "Amelia Chen",
    email: "amelia.chen@nojv.local",
    handle: "teacher_amelia",
    platformRole: "teacher",
    userId: "usr_teacher_amelia"
  })
} as const;

export const defaultLocalActor = localActorPresets.student;

export function buildActorRequestHeaders(actor: ActorIdentity) {
  return {
    "x-nojv-actor-id": actor.userId,
    "x-nojv-display-name": actor.displayName,
    "x-nojv-email": actor.email,
    "x-nojv-handle": actor.handle,
    "x-nojv-platform-role": actor.platformRole
  };
}

export function readActorIdentityFromSearchParams(searchParams: URLSearchParams) {
  const candidate = {
    displayName: searchParams.get(actorSearchParamKeys.displayName),
    email: searchParams.get(actorSearchParamKeys.email),
    handle: searchParams.get(actorSearchParamKeys.handle),
    platformRole: searchParams.get(actorSearchParamKeys.platformRole),
    userId: searchParams.get(actorSearchParamKeys.userId)
  };

  if (Object.values(candidate).some((value) => !value)) {
    return null;
  }

  const parsed = actorIdentitySchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}

export function writeActorIdentityToSearchParams(
  searchParams: URLSearchParams,
  actor: ActorIdentity
) {
  const next = new URLSearchParams(searchParams.toString());

  next.set(actorSearchParamKeys.displayName, actor.displayName);
  next.set(actorSearchParamKeys.email, actor.email);
  next.set(actorSearchParamKeys.handle, actor.handle);
  next.set(actorSearchParamKeys.platformRole, actor.platformRole);
  next.set(actorSearchParamKeys.userId, actor.userId);

  return next;
}

const slugSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const isoDateTimeSchema = z.iso.datetime();
const sourceCodeSchema = z.string().trim().min(1).max(100_000);
const sessionIdSchema = z.string().min(8).max(128);
const userIdSchema = z.string().min(3).max(64);
const relativeWorkspacePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);

export const workspaceFileSchema = z.object({
  content: z.string().max(200_000),
  path: relativeWorkspacePathSchema
});

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

export const problemCreateSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]),
  slug: slugSchema,
  statement: z.string().trim().min(16).max(12_000),
  summary: z.string().trim().min(8).max(2_000),
  title: z.string().trim().min(3).max(120),
  visibility: problemVisibilitySchema
});

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

export const problemTemplateSchema = z.object({
  driverCode: z.string().min(1).max(200_000),
  insertionMarker: z.string().min(1).max(200).default("// __USER_CODE__"),
  language: languageSchema,
  templateCode: z.string().min(1).max(100_000)
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
    opensAt: isoDateTimeSchema,
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

export const workspaceRunRequestSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    command: z.string().trim().min(1).max(512),
    contestSlug: slugSchema.optional(),
    files: z.array(workspaceFileSchema).min(1).max(64),
    mode: workspaceModeSchema,
    stdin: z.string().max(20_000).optional(),
    timeoutMs: z.coerce.number().int().min(500).max(30_000).default(5_000),
    workspaceSessionId: sessionIdSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (!value.workspaceSessionId) {
      ctx.addIssue({
        code: "custom",
        message: "workspaceSessionId is required for isolated execution",
        path: ["workspaceSessionId"]
      });
    }

    if (value.mode === "contest" && !value.contestSlug) {
      ctx.addIssue({
        code: "custom",
        message: "contestSlug is required for contest workspace runs",
        path: ["contestSlug"]
      });
    }

    if (value.mode === "exam") {
      if (!value.assessment) {
        ctx.addIssue({
          code: "custom",
          message: "assessment is required for exam workspace runs",
          path: ["assessment"]
        });
      } else if (value.assessment.kind !== "exam") {
        ctx.addIssue({
          code: "custom",
          message: "assessment.kind must be exam for exam workspace runs",
          path: ["assessment", "kind"]
        });
      }
    }

    if (value.mode === "assignment" && value.assessment?.kind === "exam") {
      ctx.addIssue({
        code: "custom",
        message: "assignment workspace runs cannot target exam assessments",
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

export const cheatingSignalSchema = z.object({
  assessment: assessmentContextSchema.optional(),
  capturedAt: isoDateTimeSchema,
  confidence: z.number().min(0).max(1),
  contestSlug: slugSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
  sessionId: sessionIdSchema.optional(),
  source: integritySignalSourceSchema,
  type: cheatingSignalTypeSchema,
  userId: userIdSchema
});

export const workspaceRunResultSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  stderr: z.string(),
  status: workspaceRunStatusSchema,
  stdout: z.string()
});

export const integrityAssessmentSchema = z.object({
  level: integrityRiskLevelSchema,
  reasons: z.array(z.string()).min(1),
  recommendedAction: z.enum(["monitor", "review", "escalate"]),
  score: z.number().min(0).max(100)
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
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

export const integrityCaseSchema = z.object({
  caseId: z.string().min(8),
  score: z.number().min(0).max(100),
  signalCount: z.number().int().nonnegative(),
  state: z.enum(["open", "under_review", "resolved"]),
  userId: userIdSchema
});

export const workspaceRunDispatchResponseSchema = z.object({
  pollUrl: z.string().min(1),
  status: workspaceOperationStatusSchema,
  workspaceRunId: z.string().min(1)
});

export const workspaceRunOperationSchema = z.object({
  result: workspaceRunResultSchema.nullable(),
  status: workspaceOperationStatusSchema,
  workspaceRunId: z.string().min(1)
});

export type AssessmentContext = z.infer<typeof assessmentContextSchema>;
export type ActorIdentity = z.infer<typeof actorIdentitySchema>;
export type CheatingSignal = z.infer<typeof cheatingSignalSchema>;
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
export type IntegrityAssessment = z.infer<typeof integrityAssessmentSchema>;
export type IntegrityCase = z.infer<typeof integrityCaseSchema>;
export type Language = z.infer<typeof languageSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type ManualCourseEnrollment = z.infer<typeof manualCourseEnrollmentSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ProblemCreate = z.infer<typeof problemCreateSchema>;
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
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type WorkspaceRunDispatchResponse = z.infer<typeof workspaceRunDispatchResponseSchema>;
export type WorkspaceRunOperation = z.infer<typeof workspaceRunOperationSchema>;
export type WorkspaceRunRequestInput = z.input<typeof workspaceRunRequestSchema>;
export type WorkspaceRunRequest = z.infer<typeof workspaceRunRequestSchema>;
export type WorkspaceRunResult = z.infer<typeof workspaceRunResultSchema>;

interface WorkspaceSessionIdentifierInput {
  assessmentSlug?: string | undefined;
  contestSlug?: string | undefined;
  courseSlug?: string | undefined;
  mode: z.infer<typeof workspaceModeSchema>;
}

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

export function buildWorkspaceSessionId(input: WorkspaceSessionIdentifierInput) {
  if (input.mode === "contest" && input.contestSlug) {
    return joinSessionSegments("ws", [input.mode, input.contestSlug]);
  }

  if (
    (input.mode === "assignment" || input.mode === "exam") &&
    input.courseSlug &&
    input.assessmentSlug
  ) {
    return joinSessionSegments("ws", [input.mode, input.courseSlug, input.assessmentSlug]);
  }

  return joinSessionSegments("ws", [input.mode]);
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

const signalWeights: Record<CheatingSignal["type"], number> = {
  concurrent_session: 34,
  focus_loss: 16,
  ip_change: 24,
  paste_burst: 22,
  shell_policy_violation: 38,
  similarity_match: 32
};

export function evaluateIntegritySignals(signals: CheatingSignal[]): IntegrityAssessment {
  const evidence = z.array(cheatingSignalSchema).min(1).parse(signals);
  const distinctTypes = new Set(evidence.map((signal) => signal.type));
  const inContest = evidence.some((signal) => Boolean(signal.contestSlug));
  let score = evidence.reduce(
    (sum, signal) => sum + signalWeights[signal.type] * signal.confidence,
    0
  );
  const reasons = new Set<string>();

  if (inContest) {
    score += 8;
    reasons.add("Contest telemetry uses stricter thresholds than practice mode.");
  }

  if (distinctTypes.size >= 3) {
    score += 12;
    reasons.add("Three independent signal classes appeared in the same review window.");
  }

  if (
    inContest &&
    distinctTypes.has("shell_policy_violation") &&
    (distinctTypes.has("focus_loss") || distinctTypes.has("paste_burst"))
  ) {
    score += 22;
    reasons.add("Contest shell policy violations sharply raise reviewer priority.");
  }

  if (distinctTypes.has("similarity_match")) {
    reasons.add(
      "Similarity evidence should be reviewed alongside runtime behavior, not in isolation."
    );
  }

  if (distinctTypes.has("concurrent_session")) {
    reasons.add(
      "Concurrent sessions on the same account are inconsistent with single-seat contest policy."
    );
  }

  if (distinctTypes.has("focus_loss") && evidence.some((signal) => signal.confidence >= 0.75)) {
    reasons.add(
      "Repeated editor focus loss suggests the participant is repeatedly leaving the exam surface."
    );
  }

  if (
    distinctTypes.has("paste_burst") &&
    evidence.some((signal) => signal.confidence >= 0.75)
  ) {
    reasons.add("Large paste bursts are unusual during supervised solving.");
  }

  if (reasons.size === 0) {
    reasons.add("Signal volume is low enough to monitor without immediate escalation.");
  }

  const normalizedScore = Math.round(Math.min(100, score));
  const level =
    normalizedScore >= 75 ? "high" : normalizedScore >= 40 ? "medium" : ("low" as const);
  const recommendedAction =
    level === "high" ? "escalate" : level === "medium" ? "review" : ("monitor" as const);

  return integrityAssessmentSchema.parse({
    level,
    reasons: [...reasons],
    recommendedAction,
    score: normalizedScore
  });
}
