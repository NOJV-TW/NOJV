import { z } from "zod";

import {
  languageSchema,
  slugSchema,
  sourceCodeSchema,
  submissionModeSchema,
  submissionOperationStatusSchema,
  submissionResultVerdictSchema,
} from "../types";
import { assessmentContextSchema } from "./course";
import { safeRelativePath } from "./path";

const sourceFileSchema = z.object({
  path: safeRelativePath,
  content: z.string().max(500_000),
});

const problemIdentifierSchema = z
  .string()
  .trim()
  .min(1, "validation_required")
  .max(128, "validation_tooLong")
  .regex(/^[A-Za-z0-9_-]+$/, "validation_slugFormat");

const MAX_RUN_CASES = 10;
const MAX_RUN_CASE_FIELD_LEN = 200_000;

export const runCaseSchema = z.object({
  input: z.string().max(MAX_RUN_CASE_FIELD_LEN),
  expectedOutput: z.string().max(MAX_RUN_CASE_FIELD_LEN).optional(),
});

export type SubmissionRunCase = z.infer<typeof runCaseSchema>;

const participationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const submissionDraftSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    contestId: slugSchema.optional(),
    participationId: participationIdSchema.optional(),
    language: languageSchema,
    mode: submissionModeSchema.optional(),
    problemId: problemIdentifierSchema,
    runCases: z.array(runCaseSchema).max(MAX_RUN_CASES).optional(),
    sampleOnly: z.boolean().optional(),
    sourceCode: sourceCodeSchema.optional(),
    sourceFiles: z.array(sourceFileSchema).max(200).optional(),
  })
  .refine(
    (draft) =>
      draft.runCases === undefined || draft.runCases.length === 0 || draft.sampleOnly === true,
    {
      message: "runCases is only allowed on sample-only (Run) submissions",
      path: ["runCases"],
    },
  );

export const MAX_CASE_STDOUT_BYTES = 1_000_000;
export const MAX_CASE_STDERR_BYTES = 100_000;
const MAX_SUBTASK_LABEL_LEN = 200;
export const MAX_FEEDBACK_LEN = 10_000;

export const caseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.string().max(16),
  timeMs: z.number().int().nonnegative(),
  memoryKb: z.number().int().nonnegative().optional(),
  stdout: z.string().max(MAX_CASE_STDOUT_BYTES).optional(),
  stderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
  testcaseId: z.string().optional(),
  staffFeedback: z.string().max(MAX_FEEDBACK_LEN).optional(),
});

export const subtaskResultItemSchema = z.object({
  cases: z.array(caseResultSchema).max(10_000),
  label: z.string().max(MAX_SUBTASK_LABEL_LEN),
  passed: z.boolean(),
  rawScore: z.number().nonnegative().optional(),
  testcaseSetId: z.string(),
  weight: z.number().int().min(1),
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(caseResultSchema).max(10_000).optional(),
  feedback: z.string().min(1).max(MAX_FEEDBACK_LEN),
  runtimeMs: z.number().int().nonnegative(),
  memoryKb: z.number().int().nonnegative().optional(),
  score: z.number().int().min(0),
  subtaskResults: z.array(subtaskResultItemSchema).max(1_000).optional(),
  verdict: submissionResultVerdictSchema,
});

export const submissionDispatchResponseSchema = z.object({
  pollUrl: z.string().min(1),
  status: submissionOperationStatusSchema,
  submissionId: z.string().min(1),
});

export const submissionOperationSchema = z.object({
  result: submissionResultSchema.nullable(),
  status: submissionOperationStatusSchema,
  submissionId: z.string().min(1),
});

export const verdictSummarySchema = z.object({
  caseSummary: z.object({
    ac: z.number().int().nonnegative(),
    wa: z.number().int().nonnegative(),
    tle: z.number().int().nonnegative(),
    mle: z.number().int().nonnegative(),
    re: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }),
  subtaskSummary: z.array(z.object({ id: z.string(), score: z.number() })).optional(),
  compilerErrorTruncated: z.string().max(1024).optional(),
});

export type CaseResult = z.infer<typeof caseResultSchema>;
export type SubtaskResultItem = z.infer<typeof subtaskResultItemSchema>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
export type VerdictSummary = z.infer<typeof verdictSummarySchema>;
