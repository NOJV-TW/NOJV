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
export const assessmentScoreboardModes = ["hidden", "live", "frozen"] as const;
export const contestScoringModes = ["icpc", "ioi"] as const;
export const courseMembershipStatuses = ["active", "invited", "pending", "removed"] as const;
export const submissionModes = ["practice", "contest", "assignment"] as const;
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

/** Default locale for database content (problem statements, user locale, etc.). */
export const DEFAULT_LOCALE = "zh-TW";

export const platformRoleSchema = z.enum(platformRoles);
export const courseRoleSchema = z.enum(courseRoles);
export const effectiveCourseRoleSchema = z.enum(effectiveCourseRoles);
export const courseJoinMethodSchema = z.enum(courseJoinMethods);
export const problemDifficultySchema = z.enum(problemDifficulties);
export const problemVisibilitySchema = z.enum(problemVisibilities);
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
  .min(3)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

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
export type ContestScoringMode = z.infer<typeof contestScoringModeSchema>;
export type SubmissionType = z.infer<typeof submissionTypeSchema>;

export const sessionUserSchema = z.object({
  disabled: z.boolean().default(false),
  email: z.string(),
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

export function formatVerdictLabel(verdict: string): string {
  return verdict.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

// --- Language starter templates ---

export const starterByLanguage: Record<Language, string> = {
  c: `#include <stdio.h>

int main() {

}
`,
  go: `package main

func main() {
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {

}
`,
  java: `import java.util.Scanner;

public class Main {
  public static void main(String[] args) {

  }
}
`,
  rust: `use std::io::{self, Read};

fn main() {

}
`,
  javascript: ``,
  typescript: ``,
  python: ``
};
