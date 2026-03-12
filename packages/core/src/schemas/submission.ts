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

export const submissionDraftSchema = z.object({
  assessment: assessmentContextSchema.optional(),
  contestSlug: slugSchema.optional(),
  language: languageSchema,
  mode: submissionModeSchema.optional(),
  problemSlug: slugSchema,
  sampleOnly: z.boolean().optional(),
  sourceCode: sourceCodeSchema
});

export const testcaseResultItemSchema = z.object({
  index: z.number().int().nonnegative(),
  passed: z.boolean(),
  stdout: z.string(),
  timeMs: z.number().int().nonnegative()
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(testcaseResultItemSchema).optional(),
  feedback: z.string().min(1),
  runtimeMs: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  verdict: submissionVerdictSchema
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

export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type SubmissionDispatchResponse = z.infer<typeof submissionDispatchResponseSchema>;
export type SubmissionOperation = z.infer<typeof submissionOperationSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
