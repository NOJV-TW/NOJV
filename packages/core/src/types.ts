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
export const courseJoinTokenKinds = ["link", "code"] as const;
export const problemDifficulties = ["easy", "medium", "hard"] as const;
export const problemVisibilities = ["public", "private"] as const;
export const problemStatuses = ["draft", "published"] as const;
export const scoreboardModes = ["hidden", "live", "frozen"] as const;
export const contestScoringModes = ["icpc", "ioi"] as const;
export const courseMembershipStatuses = ["active", "removed"] as const;
export const submissionModes = ["practice", "contest", "assignment"] as const;
export const judgeTypes = ["standard", "checker", "interactive"] as const;
export const problemTypes = ["full_source", "function", "multi_file", "special_env"] as const;
export const announcementStatuses = ["draft", "published", "archived"] as const;
export const announcementAudiences = ["all", "students", "teachers"] as const;
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
export const courseJoinTokenKindSchema = z.enum(courseJoinTokenKinds);
export const problemDifficultySchema = z.enum(problemDifficulties);
export const problemVisibilitySchema = z.enum(problemVisibilities);
export const problemStatusSchema = z.enum(problemStatuses);
export const scoreboardModeSchema = z.enum(scoreboardModes);
export const contestScoringModeSchema = z.enum(contestScoringModes);
export const courseMembershipStatusSchema = z.enum(courseMembershipStatuses);
export const languageSchema = z.enum(supportedLanguages);
export const submissionModeSchema = z.enum(submissionModes);
export const judgeTypeSchema = z.enum(judgeTypes);
export const problemTypeSchema = z.enum(problemTypes);
export const announcementStatusSchema = z.enum(announcementStatuses);
export const announcementAudienceSchema = z.enum(announcementAudiences);
export const localeCodeSchema = z.enum(localeCodes);
export const submissionVerdictSchema = z.enum(submissionVerdicts);
export const submissionOperationStatusSchema = z.enum(submissionOperationStatuses);
export const slugSchema = z
  .string()
  .min(3, "validation_slugTooShort")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "validation_slugFormat");

export const isoDateTimeSchema = z.iso.datetime();
export const sourceCodeSchema = z.string().trim().min(1).max(50_000);

export type CourseJoinTokenKind = z.infer<typeof courseJoinTokenKindSchema>;
export type CourseMembershipStatus = z.infer<typeof courseMembershipStatusSchema>;
export type CourseRole = z.infer<typeof courseRoleSchema>;
export type EffectiveCourseRole = z.infer<typeof effectiveCourseRoleSchema>;
export type ProblemDifficulty = z.infer<typeof problemDifficultySchema>;
export type JudgeType = z.infer<typeof judgeTypeSchema>;
export type Language = z.infer<typeof languageSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type ScoreboardMode = z.infer<typeof scoreboardModeSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type ProblemVisibility = z.infer<typeof problemVisibilitySchema>;
export type ProblemStatus = z.infer<typeof problemStatusSchema>;
export type ContestScoringMode = z.infer<typeof contestScoringModeSchema>;
export type ProblemType = z.infer<typeof problemTypeSchema>;
// `SubmissionMode` is no longer a Prisma enum — the `Submission.mode`
// column was deleted in the Phase 2 data-model cleanup. The concept
// (this submission belongs to a practice / contest / assignment flow)
// is still useful for UI display and domain logic, so the Zod schema
// is kept as a pure TS type.
export type SubmissionMode = z.infer<typeof submissionModeSchema>;
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

// ─── IP Lock shared schema ──────────────────────────────────────────

export const ipViolationModes = ["block", "notify"] as const;
export const ipViolationModeSchema = z.enum(ipViolationModes);
export type IpViolationMode = z.infer<typeof ipViolationModeSchema>;

export const ipViolationTypes = ["whitelist", "binding"] as const;
export const ipViolationTypeSchema = z.enum(ipViolationTypes);
export type IpViolationType = z.infer<typeof ipViolationTypeSchema>;

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
