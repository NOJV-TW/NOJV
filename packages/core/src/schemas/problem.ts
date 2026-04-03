import { z } from "zod";

import {
  languageSchema,
  problemDifficultySchema,
  problemStatusSchema,
  problemVisibilitySchema,
  slugSchema,
  submissionTypeSchema
} from "../types";

import { judgeConfigSchema } from "./judge-config";

export const problemTemplateSchema = z.object({
  driverCode: z.string().min(1).max(200_000),
  insertionMarker: z.string().min(1).max(200).default("// __USER_CODE__"),
  language: languageSchema,
  templateCode: z.string().min(1).max(100_000)
});

export const problemCreateSchema = z.object({
  difficulty: problemDifficultySchema,
  inputFormat: z.string().trim().min(1, "validation_required").max(4_000, "validation_tooLong"),
  memoryLimitMb: z.coerce.number().int().min(16).max(1024).default(256),
  outputFormat: z
    .string()
    .trim()
    .min(1, "validation_required")
    .max(4_000, "validation_tooLong"),
  slug: slugSchema.or(z.literal("")).default(""),
  statement: z.string().trim().min(1, "validation_required").max(12_000, "validation_tooLong"),
  submissionType: submissionTypeSchema.default("full_source"),
  summary: z.string().trim().max(2_000).default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  templates: z.array(problemTemplateSchema).max(10).default([]),
  timeLimitMs: z.coerce
    .number()
    .int()
    .min(100, "validation_timeLimitMin")
    .max(30_000, "validation_timeLimitMax")
    .default(1_000),
  title: z.string().trim().min(1, "validation_required").max(120, "validation_tooLong"),
  visibility: problemVisibilitySchema,
  judgeConfig: judgeConfigSchema.optional(),
  status: problemStatusSchema.default("draft")
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

export const testcaseSetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  weight: z.coerce.number().int().min(0).max(100).optional(),
  isHidden: z.boolean().optional()
});

export const testcaseUpdateSchema = problemTestcaseCaseSchema.partial();

export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: problemDifficultySchema,
  slug: slugSchema,
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
