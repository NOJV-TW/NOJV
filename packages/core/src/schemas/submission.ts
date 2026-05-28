import { z } from "zod";

import {
  languageSchema,
  slugSchema,
  sourceCodeSchema,
  submissionModeSchema,
  submissionOperationStatusSchema,
  submissionVerdictSchema,
} from "../types";
import { assessmentContextSchema } from "./course";

const sourceFileSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((value) => !value.includes("\0"), "File path must not contain NUL bytes."),
  content: z.string().max(500_000),
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
  expectedOutput: z.string().max(MAX_RUN_CASE_FIELD_LEN).optional(),
});

export type SubmissionRunCase = z.infer<typeof runCaseSchema>;

// VirtualContest ids are cuids (`@default(cuid())`), not slugs — accept the
// same identifier shape as problem ids rather than the stricter slug rule.
const virtualContestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

// `sourceCode` / `sourceFiles` carry the student's submitted bytes on inbound
// `POST /api/submissions`. They are intentionally optional on the schema so
// rejudge dispatches can re-use the same shape without carrying a placeholder —
// the worker re-loads sources from object storage at `executeSandbox` time and
// ignores any draft-side source fields. Inbound POSTs are validated at the
// usage site via `normalizeSubmissionSources`.
export const submissionDraftSchema = z
  .object({
    assessment: assessmentContextSchema.optional(),
    contestId: slugSchema.optional(),
    // A virtual-contest submission is practice-like but carries this tag so the
    // personal re-run can aggregate its own score. Mutually exclusive with the
    // contest/assessment contexts (the submission path treats it as practice).
    virtualContestId: virtualContestIdSchema.optional(),
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

// Defense-in-depth against a compromised sandbox-runner (runner already caps at 16 MB).
const MAX_CASE_STDOUT_BYTES = 1_000_000; // 1 MB per testcase
const MAX_CASE_STDERR_BYTES = 100_000; // 100 KB per testcase
const MAX_SUBTASK_LABEL_LEN = 200;
const MAX_FEEDBACK_LEN = 10_000;

export const caseResultSchema = z.object({
  index: z.number().int().nonnegative(),
  // Sandbox short code (AC/WA/TLE/MLE/RE/CE/SE); passed = verdict === "AC".
  verdict: z.string().max(16),
  timeMs: z.number().int().nonnegative(),
  memoryKb: z.number().int().nonnegative().optional(),
  stdout: z.string().max(MAX_CASE_STDOUT_BYTES).optional(),
  stderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
  testcaseId: z.string().optional(),
  // Operator/staff-only feedback (DOMjudge `judgemessage.txt`); stripped on the
  // server before the payload reaches a non-staff viewer. Same cap as the
  // top-level submission feedback (10 KB) — judgemessage.txt is operator-side
  // text, not arbitrary data.
  staffFeedback: z.string().max(MAX_FEEDBACK_LEN).optional(),
});

export const subtaskResultItemSchema = z.object({
  cases: z.array(caseResultSchema).max(10_000),
  label: z.string().max(MAX_SUBTASK_LABEL_LEN),
  passed: z.boolean(),
  testcaseSetId: z.string(),
  weight: z.number().int().min(1),
});

export const submissionResultSchema = z.object({
  accepted: z.boolean(),
  caseResults: z.array(caseResultSchema).max(10_000).optional(),
  feedback: z.string().min(1).max(MAX_FEEDBACK_LEN),
  runtimeMs: z.number().int().nonnegative(),
  memoryKb: z.number().int().nonnegative().optional(),
  score: z.number().int().min(0).max(100),
  subtaskResults: z.array(subtaskResultItemSchema).max(1_000).optional(),
  verdict: submissionVerdictSchema,
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

// Light-weight digest of a SubmissionResult; the source of truth for the full
// `caseResults` / `compilerOutput` is the verdict-detail blob in object storage.
// Kept under 4 KB so list views can render it without a storage round-trip.
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
