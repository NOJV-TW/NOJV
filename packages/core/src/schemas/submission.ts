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

// Problem IDs are persisted DB identifiers (e.g. "problem_noisy-oracle-hunt"),
// so they must allow underscores in addition to slug-like characters.
const problemIdentifierSchema = z
  .string()
  .trim()
  .min(1, "validation_required")
  .max(128, "validation_tooLong")
  .regex(/^[A-Za-z0-9_-]+$/, "validation_slugFormat");

// Custom testcases are an ephemeral Run-mode input: the student types a
// short list of stdin/expected-stdout pairs into the editor bottom panel
// and the Run button replaces the DB sample set with them for that one
// invocation. They are NEVER persisted and NEVER allowed on Submit —
// mixing student-authored input into a graded run would break the
// grading contract. Caps mirror `problemSampleSchema` (200_000 chars per
// field) so the two paths have the same upper bound.
const MAX_CUSTOM_TESTCASES = 10;
const MAX_CUSTOM_TESTCASE_FIELD_LEN = 200_000;

export const submissionCustomTestcaseSchema = z.object({
  input: z.string().max(MAX_CUSTOM_TESTCASE_FIELD_LEN),
  expectedOutput: z.string().max(MAX_CUSTOM_TESTCASE_FIELD_LEN).optional()
});

export type SubmissionCustomTestcase = z.infer<typeof submissionCustomTestcaseSchema>;

export const submissionDraftSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    contestSlug: slugSchema.optional(),
    customTestcases: z.array(submissionCustomTestcaseSchema).max(MAX_CUSTOM_TESTCASES).optional(),
    language: languageSchema,
    mode: submissionModeSchema.optional(),
    problemId: problemIdentifierSchema,
    sampleOnly: z.boolean().optional(),
    sourceCode: sourceCodeSchema,
    sourceFiles: z.array(sourceFileSchema).max(200).optional()
  })
  .refine(
    (draft) =>
      draft.customTestcases === undefined ||
      draft.customTestcases.length === 0 ||
      draft.sampleOnly === true,
    {
      message: "customTestcases is only allowed on sample-only (Run) submissions",
      path: ["customTestcases"]
    }
  );

// Output caps are defense-in-depth against a compromised or modified
// sandbox-runner. The runner's `createBoundedBuffer` already caps the
// raw child-process stream at 16 MB, so a well-behaved runner never gets
// close to these limits. Per-field caps stop a bad runner from
// overflowing downstream storage/rendering.
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
  // Sandbox-layer verdicts ("AC" / "WA" / "TLE" / ...) not the DB enum
  // — the conversion to `submissionVerdictSchema` happens in the judge
  // activity's verdictMap. Capped at 16 chars to prevent a malicious
  // runner from sending arbitrary-length labels.
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
