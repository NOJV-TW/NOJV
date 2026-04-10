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
export const problemDifficulties = ["easy", "medium", "hard"] as const;
export const problemVisibilities = ["public", "private"] as const;
export const problemStatuses = ["draft", "published"] as const;
export const assessmentScoreboardModes = ["hidden", "live", "frozen"] as const;
export const contestScoringModes = ["icpc", "ioi"] as const;
export const courseMembershipStatuses = ["active", "invited", "pending", "removed"] as const;
export const submissionModes = ["practice", "contest", "assignment"] as const;
export const judgeTypes = ["standard", "checker", "interactive"] as const;
export const submissionTypes = ["function", "full_source", "zip_project"] as const;
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

/** Default locale for database content (problem statements, user locale, etc.). */
export const DEFAULT_LOCALE = "zh-TW";

export const platformRoleSchema = z.enum(platformRoles);
export const courseRoleSchema = z.enum(courseRoles);
export const effectiveCourseRoleSchema = z.enum(effectiveCourseRoles);
export const courseJoinMethodSchema = z.enum(courseJoinMethods);
export const problemDifficultySchema = z.enum(problemDifficulties);
export const problemVisibilitySchema = z.enum(problemVisibilities);
export const problemStatusSchema = z.enum(problemStatuses);
export const assessmentScoreboardModeSchema = z.enum(assessmentScoreboardModes);
export const contestScoringModeSchema = z.enum(contestScoringModes);
export const courseMembershipStatusSchema = z.enum(courseMembershipStatuses);
export const languageSchema = z.enum(supportedLanguages);
export const submissionModeSchema = z.enum(submissionModes);
export const judgeTypeSchema = z.enum(judgeTypes);
export const submissionTypeSchema = z.enum(submissionTypes);
export const localeCodeSchema = z.enum(localeCodes);
export const submissionVerdictSchema = z.enum(submissionVerdicts);
export const submissionOperationStatusSchema = z.enum(submissionOperationStatuses);
export const slugSchema = z
  .string()
  .min(3, "validation_slugTooShort")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "validation_slugFormat");

export const isoDateTimeSchema = z.iso.datetime();
export const sourceCodeSchema = z.string().trim().min(1).max(50_000);

export type CourseJoinMethod = z.infer<typeof courseJoinMethodSchema>;
export type CourseMembershipStatus = z.infer<typeof courseMembershipStatusSchema>;
export type CourseRole = z.infer<typeof courseRoleSchema>;
export type EffectiveCourseRole = z.infer<typeof effectiveCourseRoleSchema>;
export type ProblemDifficulty = z.infer<typeof problemDifficultySchema>;
export type JudgeType = z.infer<typeof judgeTypeSchema>;
export type Language = z.infer<typeof languageSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type AssessmentScoreboardMode = z.infer<typeof assessmentScoreboardModeSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ProblemVisibility = z.infer<typeof problemVisibilitySchema>;
export type ProblemStatus = z.infer<typeof problemStatusSchema>;
export type ContestScoringMode = z.infer<typeof contestScoringModeSchema>;
export type SubmissionType = z.infer<typeof submissionTypeSchema>;

// ─── IP Lock shared schema ──────────────────────────────────────────

export const ipViolationModes = ["block", "notify"] as const;
export const ipViolationModeSchema = z.enum(ipViolationModes);
export type IpViolationMode = z.infer<typeof ipViolationModeSchema>;

// CIDR strings cap at 50 chars (~39 for IPv6 /128 + margin), 1000 entries
// per list is more than any reasonable deployment. 50 KB text cap covers
// the same count even with generous formatting.
const MAX_CIDR_LEN = 50;
const MAX_WHITELIST_ENTRIES = 1000;
const MAX_WHITELIST_TEXT_LEN = 50_000;

/** Shared Zod fields for IP lock configuration. Use with z.object({ ...ipLockFields, ... }) */
export const ipLockFields = {
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelist: z
    .array(z.string().trim().min(1).max(MAX_CIDR_LEN))
    .max(MAX_WHITELIST_ENTRIES)
    .default([]),
  ipWhitelistEnabled: z.boolean().default(false)
} as const;

/** Shared Zod fields for IP lock form (textarea variant for whitelist). */
export const ipLockFormFields = {
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelistEnabled: z.boolean().default(false),
  ipWhitelistText: z.string().max(MAX_WHITELIST_TEXT_LEN).default("")
} as const;

export const sessionUserSchema = z.object({
  disabled: z.boolean().default(false),
  email: z.string(),
  emailVerified: z.boolean().default(false),
  username: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  platformRole: platformRoleSchema
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const apiErrorSchema = z.object({
  message: z.string()
});

export const actionErrorSchema = z.object({
  error: z.string()
});

export const broadcastVerifiedSchema = z.object({
  type: z.literal("verified")
});
