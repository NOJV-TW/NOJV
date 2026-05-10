import { z } from "zod";

import {
  languageSchema,
  problemDifficultySchema,
  problemStatusSchema,
  problemTypeSchema,
  problemVisibilitySchema,
  type Language,
} from "../types";

import { judgeConfigSchema } from "./judge-config";
import { requiredPathsSchema } from "./required-paths";

// 16 MB cap on blob-backed fields: API payload safety, not a storage bound.
const BLOB_FIELD_MAX_BYTES = 16 * 1024 * 1024;

export const problemImageSourceSchema = z.enum(["registry", "tarball"]);
export type ProblemImageSource = z.infer<typeof problemImageSourceSchema>;

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
  path: z
    .string()
    .min(1)
    .max(500)
    .refine((p) => !p.startsWith("/") && !p.includes(".."), {
      message: "path must be relative and must not contain ..",
    }),
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

// Separate from `problemCreateSchema` so `problemUpdateSchema` can `.partial()` it;
// the special_env/image-config refine runs only on create and in the mutation layer.
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
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
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
  // Sample IO + special_env image config
  samples: problemSamplesSchema.optional(),
  advancedImageRef: z.string().max(500).optional(),
  advancedImageSource: problemImageSourceSchema.optional(),
  advancedRequiredPaths: requiredPathsSchema.optional(),
});

export const problemCreateSchema = problemCreateObjectSchema.superRefine((data, ctx) => {
  const isSpecialEnv = data.type === "special_env";
  const hasImageRef = !!data.advancedImageRef && data.advancedImageRef.trim().length > 0;
  const hasImageSource = !!data.advancedImageSource;

  if (isSpecialEnv) {
    if (!hasImageRef) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedImageRef"],
        message: "validation_required",
      });
    }
    if (!hasImageSource) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedImageSource"],
        message: "validation_required",
      });
    }
  } else {
    // Non-special_env must NOT carry image config.
    if (hasImageRef) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedImageRef"],
        message: "validation_onlyAllowedForSpecialEnv",
      });
    }
    if (hasImageSource) {
      ctx.addIssue({
        code: "custom",
        path: ["advancedImageSource"],
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
  weight: z.coerce.number().int().min(1).max(100),
});

export const problemTestcaseSetCreateSchema = z.object({
  cases: z.array(problemTestcaseCaseSchema).min(1).max(256),
  description: z.string().max(5_000).default(""),
  name: z.string().trim().min(1).max(120),
  weight: z.coerce.number().int().min(1).max(100).default(1),
});

export const testcaseSetUpdateSchema = z.object({
  description: z.string().max(5_000).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  weight: z.coerce.number().int().min(0).max(100).optional(),
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
