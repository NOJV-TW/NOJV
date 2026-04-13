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

// Problem IDs use underscores (e.g. "problem_noisy-oracle-hunt"), not just slug chars.
const problemIdentifierSchema = z
  .string()
  .trim()
  .min(1, "validation_required")
  .max(128, "validation_tooLong")
  .regex(/^[A-Za-z0-9_-]+$/, "validation_slugFormat");

// runCases are ephemeral student-authored Run-mode inputs — never persisted
// and never allowed on Submit (would break the grading contract).
const MAX_RUN_CASES = 10;
const MAX_RUN_CASE_FIELD_LEN = 200_000;

export const runCaseSchema = z.object({
  input: z.string().max(MAX_RUN_CASE_FIELD_LEN),
  expectedOutput: z.string().max(MAX_RUN_CASE_FIELD_LEN).optional()
});

export type SubmissionRunCase = z.infer<typeof runCaseSchema>;

export const submissionDraftSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    contestSlug: slugSchema.optional(),
    language: languageSchema,
    mode: submissionModeSchema.optional(),
    problemId: problemIdentifierSchema,
    runCases: z.array(runCaseSchema).max(MAX_RUN_CASES).optional(),
    sampleOnly: z.boolean().optional(),
    sourceCode: sourceCodeSchema,
    sourceFiles: z.array(sourceFileSchema).max(200).optional()
  })
  .refine(
    (draft) =>
      draft.runCases === undefined || draft.runCases.length === 0 || draft.sampleOnly === true,
    {
      message: "runCases is only allowed on sample-only (Run) submissions",
      path: ["runCases"]
    }
  );

// Defense-in-depth against a compromised sandbox-runner (runner already caps at 16 MB).
const MAX_CASE_STDOUT_BYTES = 1_000_000; // 1 MB per testcase
const MAX_CASE_STDERR_BYTES = 100_000; // 100 KB per testcase
const MAX_SUBTASK_LABEL_LEN = 200;
const MAX_FEEDBACK_LEN = 10_000;

export const testcaseResultItemSchema = z.object({
  index: z.number().int().nonnegative(),
  passed: z.boolean(),
  stderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
  stdout: z.string().max(MAX_CASE_STDOUT_BYTES),
  timeMs: z.number().int().nonnegative()
});

export const subtaskCaseResultSchema = z.object({
  memoryKb: z.number().int().nonnegative().optional(),
  ordinal: z.number().int(),
  runtimeMs: z.number().int().nonnegative(),
  testcaseId: z.string(),
  // Sandbox verdict string ("AC"/"WA"/...); mapped to DB enum in judge activity.
  verdict: z.string().max(16)
});

export const subtaskResultItemSchema = z.object({
  cases: z.array(subtaskCaseResultSchema).max(10_000),
  label: z.string().max(MAX_SUBTASK_LABEL_LEN),
  passed: z.boolean(),
  testcaseSetId: z.string(),
  weight: z.number().int().min(1)
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(testcaseResultItemSchema).max(10_000).optional(),
  feedback: z.string().min(1).max(MAX_FEEDBACK_LEN),
  runtimeMs: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  subtaskResults: z.array(subtaskResultItemSchema).max(1_000).optional(),
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

export type SubtaskCaseResult = z.infer<typeof subtaskCaseResultSchema>;
export type SubtaskResultItem = z.infer<typeof subtaskResultItemSchema>;
export type SubmissionDraft = z.infer<typeof submissionDraftSchema>;
export type SubmissionResult = z.infer<typeof submissionResultSchema>;
