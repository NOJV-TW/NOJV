import { z } from "zod";

export const supportedLanguages = [
  "c",
  "cpp",
  "go",
  "java",
  "javascript",
  "python",
  "rust",
  "typescript",
] as const;

export const platformRoles = ["admin", "teacher", "student"] as const;
export const userStatuses = ["active", "disabled", "pending_first_login"] as const;
export const courseRoles = ["teacher", "ta", "student"] as const;
export const effectiveCourseRoles = ["admin", "teacher", "ta", "student"] as const;
export const problemDifficulties = ["easy", "medium", "hard"] as const;
export const problemVisibilities = ["public", "private"] as const;
export const problemStatuses = ["draft", "published"] as const;
export const scoreboardModes = ["hidden", "live", "frozen"] as const;
export const contestScoringModes = ["problem_count", "point_sum"] as const;
export const courseMembershipStatuses = ["active", "removed"] as const;
export const submissionModes = ["practice", "contest", "assignment", "virtual"] as const;
export const judgeTypes = ["standard", "checker", "interactive"] as const;
export const problemTypes = ["full_source", "multi_file", "special_env"] as const;
export const announcementStatuses = ["draft", "published", "archived"] as const;
export const announcementAudiences = ["all", "students", "teachers"] as const;
export const submissionVerdicts = [
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded",
] as const;

export const submissionResultVerdicts = [...submissionVerdicts, "system_error"] as const;
export const submissionOperationStatuses = [
  "pending_upload",
  "queued",
  "compiling",
  "running",
  "accepted",
  "wrong_answer",
  "compile_error",
  "runtime_error",
  "time_limit_exceeded",
  "memory_limit_exceeded",
  "system_error",
] as const;

export const localeCodes = ["en", "zh-TW"] as const;

export const DEFAULT_LOCALE = "zh-TW";

export const platformRoleSchema = z.enum(platformRoles);
export const userStatusSchema = z.enum(userStatuses);
export const courseRoleSchema = z.enum(courseRoles);
export const effectiveCourseRoleSchema = z.enum(effectiveCourseRoles);
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
export const submissionResultVerdictSchema = z.enum(submissionResultVerdicts);
export const submissionOperationStatusSchema = z.enum(submissionOperationStatuses);
export const slugSchema = z
  .string()
  .min(3, "validation_slugTooShort")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "validation_slugFormat");

export const isoDateTimeSchema = z.iso.datetime();
export const sourceCodeSchema = z.string().trim().min(1).max(50_000);

export type CourseMembershipStatus = z.infer<typeof courseMembershipStatusSchema>;
export type CourseRole = z.infer<typeof courseRoleSchema>;
export type EffectiveCourseRole = z.infer<typeof effectiveCourseRoleSchema>;
export type ProblemDifficulty = z.infer<typeof problemDifficultySchema>;
export type JudgeType = z.infer<typeof judgeTypeSchema>;
export type Language = z.infer<typeof languageSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type ScoreboardMode = z.infer<typeof scoreboardModeSchema>;
export type PlatformRole = z.infer<typeof platformRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type ProblemVisibility = z.infer<typeof problemVisibilitySchema>;
export type ProblemStatus = z.infer<typeof problemStatusSchema>;
export type ContestScoringMode = z.infer<typeof contestScoringModeSchema>;
export type ProblemType = z.infer<typeof problemTypeSchema>;
export type SubmissionMode = z.infer<typeof submissionModeSchema>;
export type AnnouncementStatus = z.infer<typeof announcementStatusSchema>;
export type AnnouncementAudience = z.infer<typeof announcementAudienceSchema>;

export const ipViolationModes = ["block", "notify"] as const;
export const ipViolationModeSchema = z.enum(ipViolationModes);
export type IpViolationMode = z.infer<typeof ipViolationModeSchema>;

export const ipViolationTypes = ["whitelist", "binding"] as const;
export const ipViolationTypeSchema = z.enum(ipViolationTypes);
export type IpViolationType = z.infer<typeof ipViolationTypeSchema>;

export const IP_WHITELIST_MAX_CIDR_LENGTH = 50;
export const IP_WHITELIST_MAX_ENTRIES = 1000;
export const IP_WHITELIST_MAX_TEXT_LENGTH = 50_000;

export function parseIpWhitelistText(text: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of text.split(/[\s,;]+/u)) {
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    entries.push(trimmed);
  }
  return entries;
}

export const ipLockFields = {
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelist: z
    .array(z.string().trim().min(1).max(IP_WHITELIST_MAX_CIDR_LENGTH))
    .max(IP_WHITELIST_MAX_ENTRIES)
    .default([]),
  ipWhitelistEnabled: z.boolean().default(false),
} as const;

export const ipLockFormFields = {
  ipBindingEnabled: z.boolean().default(false),
  ipViolationMode: ipViolationModeSchema.default("block"),
  ipWhitelistEnabled: z.boolean().default(false),
  ipWhitelistText: z.string().max(IP_WHITELIST_MAX_TEXT_LENGTH).default(""),
} as const;

export const sessionUserSchema = z.object({
  disabled: z.boolean().default(false),
  email: z.string(),
  emailVerified: z.boolean().default(false),
  username: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  platformRole: platformRoleSchema,
  status: userStatusSchema.default("active"),
  mustChangePassword: z.boolean().default(false),
  twoFactorEnabled: z.boolean().default(false),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const apiErrorSchema = z.object({
  message: z.string(),
});

export const actionErrorSchema = z.object({
  error: z.string(),
});

export const broadcastVerifiedSchema = z.object({
  type: z.literal("verified"),
});
