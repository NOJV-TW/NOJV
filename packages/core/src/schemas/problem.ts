import { z } from "zod";

import {
  judgeTypeSchema,
  languageSchema,
  problemVisibilitySchema,
  slugSchema,
  submissionTypeSchema
} from "../types";

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

export const problemOverviewSchema = z.object({
  acceptanceRate: z.number().min(0).max(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  slug: slugSchema,
  title: z.string().min(1),
  totalSubmissions: z.number().int().nonnegative()
});

export type ProblemCreate = z.infer<typeof problemCreateSchema>;
export type ProblemUpdate = z.infer<typeof problemUpdateSchema>;
export type ProblemTemplate = z.infer<typeof problemTemplateSchema>;
export type ProblemTestcaseCase = z.infer<typeof problemTestcaseCaseSchema>;
export type ProblemJudgeTestcase = z.infer<typeof problemJudgeTestcaseSchema>;
export type ProblemTestcaseSetCreate = z.infer<typeof problemTestcaseSetCreateSchema>;
export type ProblemOverview = z.infer<typeof problemOverviewSchema>;
