import { z } from "zod";

import {
  languageSchema,
  problemDifficultySchema,
  problemStatusSchema,
  problemVisibilitySchema,
  submissionTypeSchema,
  type Language
} from "../types";

import { judgeConfigSchema } from "./judge-config";

// ─── Phase 1 redesign: problem mode + samples + workspace files ────

export const problemModeSchema = z.enum(["standard", "advanced"]);
export type ProblemMode = z.infer<typeof problemModeSchema>;

export const problemImageSourceSchema = z.enum(["registry", "tarball"]);
export type ProblemImageSource = z.infer<typeof problemImageSourceSchema>;

export const advancedResourceLimitsSchema = z.object({
  totalTimeMs: z.number().int().min(1_000).max(600_000),
  memoryMb: z.number().int().min(16).max(8_192),
  networkEnabled: z.boolean()
});

export type AdvancedResourceLimits = z.infer<typeof advancedResourceLimitsSchema>;

export const problemSampleSchema = z.object({
  stdin: z.string().max(200_000),
  expected: z.string().max(200_000)
});

export type ProblemSample = z.infer<typeof problemSampleSchema>;

export const problemSamplesSchema = z.array(problemSampleSchema).max(5);

export type ProblemSamples = z.infer<typeof problemSamplesSchema>;

export const workspaceFileVisibilitySchema = z.enum(["editable", "readonly", "hidden"]);

export type WorkspaceFileVisibility = z.infer<typeof workspaceFileVisibilitySchema>;

/**
 * An [startLine, endLine] inclusive tuple designating a line range the
 * student is allowed to edit. Lines outside all declared ranges are
 * rendered read-only in the browser editor.
 */
export const editableRegionSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative()
]);

export type EditableRegion = z.infer<typeof editableRegionSchema>;

export const problemWorkspaceFileSchema = z.object({
  language: languageSchema,
  path: z
    .string()
    .min(1)
    .max(500)
    .refine((p) => !p.startsWith("/") && !p.includes(".."), {
      message: "path must be relative and must not contain .."
    }),
  content: z.string().max(200_000),
  visibility: workspaceFileVisibilitySchema,
  editableRegions: z.array(editableRegionSchema).max(50).nullable().optional(),
  description: z.string().max(5_000).default(""),
  orderIndex: z.number().int().nonnegative().default(0)
});

export type ProblemWorkspaceFile = z.infer<typeof problemWorkspaceFileSchema>;

/**
 * Canonical file extension for each supported language — shared between
 * the workspace editor, the judge, and the submission validator so they
 * always agree on paths like `main.py` or `main.cpp`.
 */
export function languageExtension(language: Language): string {
  const map: Record<Language, string> = {
    c: "c",
    cpp: "cpp",
    go: "go",
    java: "java",
    javascript: "js",
    python: "py",
    rust: "rs",
    typescript: "ts"
  };
  return map[language];
}

/**
 * Workspace-mode convention: every enabled language must provide an
 * editable entry file named `main.<ext>`. Hard-coding the basename keeps
 * the judge, the submission validator, and the UI in agreement about
 * "where does the student start editing".
 */
export const ENTRY_FILE_BASENAME = "main";

export function entryFileNameFor(language: Language): string {
  return `${ENTRY_FILE_BASENAME}.${languageExtension(language)}`;
}

export const problemCreateSchema = z.object({
  difficulty: problemDifficultySchema,
  inputFormat: z.string().trim().min(1, "validation_required").max(4_000, "validation_tooLong"),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  outputFormat: z
    .string()
    .trim()
    .min(1, "validation_required")
    .max(4_000, "validation_tooLong"),
  statement: z.string().trim().min(1, "validation_required").max(12_000, "validation_tooLong"),
  submissionType: submissionTypeSchema.default("full_source"),
  summary: z.string().trim().max(2_000).default(""),
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
  // Phase 1 redesign: standard vs advanced mode, samples, advanced image refs
  mode: problemModeSchema.default("standard"),
  samples: problemSamplesSchema.optional(),
  advancedImageRef: z.string().max(500).optional(),
  advancedImageSource: problemImageSourceSchema.optional(),
  advancedResourceLimits: advancedResourceLimitsSchema.optional()
});

export const problemUpdateSchema = problemCreateSchema.partial();

export const problemTestcaseCaseSchema = z.object({
  expectedStdout: z.string().max(200_000),
  stdin: z.string().max(200_000)
});

export const problemJudgeTestcaseSchema = z.object({
  expectedStdout: z.string().max(200_000).optional(),
  id: z.string().trim().min(1),
  inputFiles: z.record(z.string(), z.string()).optional(),
  stdin: z.string().max(200_000),
  weight: z.coerce.number().int().min(1).max(100)
});

export const problemTestcaseSetCreateSchema = z.object({
  cases: z.array(problemTestcaseCaseSchema).min(1).max(256),
  name: z.string().trim().min(1).max(120),
  weight: z.coerce.number().int().min(1).max(100).default(1)
});

export const testcaseSetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  weight: z.coerce.number().int().min(0).max(100).optional()
});

export const testcaseUpdateSchema = problemTestcaseCaseSchema.partial();

export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: problemDifficultySchema,
  id: z.string().min(1),
  title: z.string().min(1),
  totalSubmissions: z.number().int().nonnegative()
});

export type ProblemCreate = z.infer<typeof problemCreateSchema>;
export type ProblemUpdate = z.infer<typeof problemUpdateSchema>;
export type ProblemJudgeTestcase = z.infer<typeof problemJudgeTestcaseSchema>;
export type ProblemTestcaseSetCreate = z.infer<typeof problemTestcaseSetCreateSchema>;
export type TestcaseSetUpdate = z.infer<typeof testcaseSetUpdateSchema>;
export type TestcaseUpdate = z.infer<typeof testcaseUpdateSchema>;
export type ProblemOverview = z.infer<typeof problemOverviewSchema>;
