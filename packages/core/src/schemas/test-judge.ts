import { z } from "zod";

import { languageSchema } from "../types";
import { judgeScriptLanguageSchema } from "./judge-config";
import {
  MAX_CASE_STDERR_BYTES,
  MAX_CASE_STDOUT_BYTES,
  MAX_FEEDBACK_LEN,
  submissionContextSchema,
} from "./submission";

export const TEST_JUDGE_MAX_CASES = 15;
export const TEST_JUDGE_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const TEST_JUDGE_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
export const TEST_JUDGE_TRANSCRIPT_BYTES = 64 * 1024;

const caseTextSchema = z.string().max(200_000);

export const testJudgeCheckerCaseSchema = z
  .object({
    input: caseTextSchema,
    expectedOutput: caseTextSchema,
    output: z.string().max(MAX_CASE_STDOUT_BYTES),
  })
  .strict();

export const testJudgeInteractiveCaseSchema = z
  .object({ interactorInput: caseTextSchema })
  .strict();

const uploadedArtifactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("wasm"),
      bytesBase64: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ kind: z.literal("runtime-bundle"), artifact: z.record(z.string(), z.unknown()) })
    .strict(),
]);

export const testJudgeRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("checker"),
      context: submissionContextSchema,
      cases: z.array(testJudgeCheckerCaseSchema).min(1).max(TEST_JUDGE_MAX_CASES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("interactive"),
      context: submissionContextSchema,
      language: languageSchema,
      artifact: uploadedArtifactSchema,
      cases: z.array(testJudgeInteractiveCaseSchema).min(1).max(TEST_JUDGE_MAX_CASES),
    })
    .strict(),
]);

export const testJudgeCaseResultSchema = z
  .object({
    verdict: z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]),
    teamMessage: z.string().max(MAX_FEEDBACK_LEN).optional(),
    contestantStderr: z.string().max(MAX_CASE_STDERR_BYTES).optional(),
    transcript: z
      .object({
        toInteractor: z.string().max(TEST_JUDGE_TRANSCRIPT_BYTES),
        toContestant: z.string().max(TEST_JUDGE_TRANSCRIPT_BYTES),
      })
      .strict()
      .optional(),
    timeMs: z.number().int().nonnegative().optional(),
  })
  .strict();

export const testJudgeResponseSchema = z
  .object({ cases: z.array(testJudgeCaseResultSchema) })
  .strict();

export const testJudgeErrorCodes = [
  "test_judge_unavailable",
  "test_judge_busy",
  "judge_program_build_failed",
  "judge_program_unsupported",
] as const;

const storageObjectPointerSchema = z.object({
  key: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});

export const testJudgeStoredRequestSchema = z
  .object({
    kind: z.enum(["checker", "interactive"]),
    judgeLanguage: judgeScriptLanguageSchema,
    judgeScriptPointer: storageObjectPointerSchema,
    timeLimitMs: z.number().int().positive(),
    memoryLimitMb: z.number().int().positive(),
    runtimeEnv: z.record(z.string(), z.string()),
    contestantLanguage: languageSchema.optional(),
    checkerCases: z.array(testJudgeCheckerCaseSchema).optional(),
    interactiveCases: z.array(testJudgeInteractiveCaseSchema).optional(),
    artifact: uploadedArtifactSchema.optional(),
  })
  .strict();

export type TestJudgeRequest = z.infer<typeof testJudgeRequestSchema>;
export type TestJudgeCaseResult = z.infer<typeof testJudgeCaseResultSchema>;
export type TestJudgeResponse = z.infer<typeof testJudgeResponseSchema>;
export type TestJudgeErrorCode = (typeof testJudgeErrorCodes)[number];
export type TestJudgeStoredRequest = z.infer<typeof testJudgeStoredRequestSchema>;
