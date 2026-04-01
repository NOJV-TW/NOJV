import { z } from "zod";

import {
  languageSchema,
  slugSchema,
  sourceCodeSchema,
  submissionModeSchema,
  submissionOperationStatusSchema,
  submissionVerdictSchema
} from "../types";
import { assessmentContextSchema } from "./course";

const sourceFileSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((value) => !value.includes("\0"), "File path must not contain NUL bytes."),
  content: z.string().max(500_000)
});

export const submissionDraftSchema = z.object({
  assessment: assessmentContextSchema.optional(),
  contestSlug: slugSchema.optional(),
  entryFile: z.string().trim().min(1).max(300).optional(),
  language: languageSchema,
  mode: submissionModeSchema.optional(),
  problemSlug: slugSchema,
  sampleOnly: z.boolean().optional(),
  sourceCode: sourceCodeSchema,
  sourceFiles: z.array(sourceFileSchema).max(200).optional()
});

export const testcaseResultItemSchema = z.object({
  index: z.number().int().nonnegative(),
  passed: z.boolean(),
  stderr: z.string().optional(),
  stdout: z.string(),
  timeMs: z.number().int().nonnegative()
});

export const subtaskCaseResultSchema = z.object({
  memoryKb: z.number().int().nonnegative().optional(),
  ordinal: z.number().int(),
  runtimeMs: z.number().int().nonnegative(),
  testcaseId: z.string(),
  verdict: z.string()
});

export const subtaskResultItemSchema = z.object({
  cases: z.array(subtaskCaseResultSchema),
  label: z.string(),
  passed: z.boolean(),
  testcaseSetId: z.string(),
  weight: z.number().int().min(1)
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(testcaseResultItemSchema).optional(),
  feedback: z.string().min(1),
  runtimeMs: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  subtaskResults: z.array(subtaskResultItemSchema).optional(),
  verdict: submissionVerdictSchema,
  pipelineResult: z.record(z.string(), z.unknown()).optional(),
  artifactPaths: z.array(z.string()).optional()
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

export type SubtaskCaseResult = z.infer<typeof subtaskCaseResultSchema>;
export type SubtaskResultItem = z.infer<typeof subtaskResultItemSchema>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
