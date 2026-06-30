import { z } from "zod";

import {
  languageSchema,
  problemDifficultySchema,
  problemStatusSchema,
  problemTypeSchema,
  problemVisibilitySchema,
  problemTags,
  type Language,
} from "../types";

import { advancedConfigSchema, imageSourceSchema } from "./advanced-mode";
import { judgeConfigSchema } from "./judge-config";
import { safeRelativePath } from "./path";
import { requiredPathsSchema } from "./required-paths";

const BLOB_FIELD_MAX_BYTES = 16 * 1024 * 1024;

export const problemImageSourceSchema = imageSourceSchema;
export type ProblemImageSource = z.infer<typeof imageSourceSchema>;

export const problemSampleSchema = z.object({
  input: z.string().max(200_000),
  output: z.string().max(200_000),
});

export type ProblemSample = z.infer<typeof problemSampleSchema>;

export const problemSamplesSchema = z.array(problemSampleSchema).max(5);

export type ProblemSamples = z.infer<typeof problemSamplesSchema>;

export const workspaceFileVisibilitySchema = z.enum(["editable", "readonly", "hidden"]);

export type WorkspaceFileVisibility = z.infer<typeof workspaceFileVisibilitySchema>;

export const problemWorkspaceFileSchema = z.object({
  language: languageSchema,
  path: safeRelativePath,
  content: z.string().max(BLOB_FIELD_MAX_BYTES),
  visibility: workspaceFileVisibilitySchema,
  description: z.string().max(5_000).default(""),
  orderIndex: z.number().int().nonnegative().default(0),
});

export type ProblemWorkspaceFile = z.infer<typeof problemWorkspaceFileSchema>;

export function languageExtension(language: Language): string {
  const map: Record<Language, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "js",
    python: "py",
    rust: "rs",
    typescript: "ts",
  };
  return map[language];
}

export const ENTRY_FILE_BASENAME = "main";

export function entryFileNameFor(language: Language): string {
  return `${ENTRY_FILE_BASENAME}.${languageExtension(language)}`;
}

const problemCreateObjectSchema = z.object({
  difficulty: problemDifficultySchema,
  inputFormat: z.string().trim().min(1, "validation_required").max(4_000, "validation_tooLong"),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  outputFormat: z
    .string()
    .trim()
    .min(1, "validation_required")
    .max(4_000, "validation_tooLong"),
  statement: z.string().trim().min(1, "validation_required").max(12_000, "validation_tooLong"),
  type: problemTypeSchema.default("full_source"),
  tags: z
    .array(
      z
        .string()
        .trim()
        .refine((tag) => (problemTags as readonly string[]).includes(tag), "validation_invalidTag"),
    )
    .max(20)
    .default([]),
  timeLimitMs: z.coerce
    .number()
    .int()
    .min(100, "validation_timeLimitMin")
    .max(30_000, "validation_timeLimitMax")
    .default(1_000),
  title: z.string().trim().min(1, "validation_required").max(120, "validation_tooLong"),
  visibility: problemVisibilitySchema,
  judgeConfig: judgeConfigSchema.optional(),
  status: problemStatusSchema.default("draft"),
  samples: problemSamplesSchema.optional(),
  advancedConfig: advancedConfigSchema.optional(),
  advancedRequiredPaths: requiredPathsSchema.optional(),
});

export const problemCreateSchema = problemCreateObjectSchema.superRefine((data, ctx) => {
  const isSpecialEnv = data.type === "special_env";
  const hasAdvancedConfig = data.advancedConfig !== undefined;

  if (isSpecialEnv) {
    if (!hasAdvancedConfig) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedConfig"],
        message: "validation_required",
      });
    }
  } else {
    if (hasAdvancedConfig) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedConfig"],
        message: "validation_onlyAllowedForSpecialEnv",
      });
    }
    if ((data.advancedRequiredPaths ?? []).length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedRequiredPaths"],
        message: "validation_onlyAllowedForSpecialEnv",
      });
    }
  }
});

export const problemUpdateSchema = problemCreateObjectSchema.partial();

export const problemTestcaseCaseSchema = z.object({
  output: z.string().max(BLOB_FIELD_MAX_BYTES),
  input: z.string().max(BLOB_FIELD_MAX_BYTES),
});

export const problemJudgeTestcaseSchema = z.object({
  output: z.string().max(BLOB_FIELD_MAX_BYTES).optional(),
  id: z.string().trim().min(1),
  inputFiles: z.record(z.string(), z.string().max(BLOB_FIELD_MAX_BYTES)).optional(),
  input: z.string().max(BLOB_FIELD_MAX_BYTES),
  weight: z.coerce.number().int().min(1).max(100_000),
});

export const problemTestcaseSetCreateSchema = z.object({
  cases: z.array(problemTestcaseCaseSchema).min(1).max(256),
  description: z.string().max(5_000).default(""),
  name: z.string().trim().min(1).max(120),
  weight: z.coerce.number().int().min(1).max(100_000).default(1),
});

export const testcaseSetUpdateSchema = z.object({
  description: z.string().max(5_000).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  weight: z.coerce.number().int().min(0).max(100_000).optional(),
});

export const testcaseUpdateSchema = problemTestcaseCaseSchema.partial();

export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: problemDifficultySchema,
  displayId: z.number().int().positive(),
  id: z.string().min(1),
  title: z.string().min(1),
  totalSubmissions: z.number().int().nonnegative(),
});

export type ProblemCreate = z.infer<typeof problemCreateSchema>;
export type ProblemUpdate = z.infer<typeof problemUpdateSchema>;
export type ProblemJudgeTestcase = z.infer<typeof problemJudgeTestcaseSchema>;
export type ProblemTestcaseSetCreate = z.infer<typeof problemTestcaseSetCreateSchema>;
export type TestcaseSetUpdate = z.infer<typeof testcaseSetUpdateSchema>;
export type TestcaseUpdate = z.infer<typeof testcaseUpdateSchema>;
export type ProblemOverview = z.infer<typeof problemOverviewSchema>;
