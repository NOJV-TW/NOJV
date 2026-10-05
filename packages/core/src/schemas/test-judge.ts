import { z } from "zod";

import { languageSchema } from "../types";
import { judgeScriptLanguageSchema } from "./judge-config";
import {
  MAX_CASE_STDERR_BYTES,
  MAX_CASE_STDOUT_BYTES,
  MAX_FEEDBACK_LEN,
  MAX_RUN_CASE_FIELD_LEN,
  submissionContextSchema,
} from "./submission";

export const TEST_JUDGE_MAX_CASES = 15;
export const TEST_JUDGE_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const TEST_JUDGE_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
export const TEST_JUDGE_TRANSCRIPT_BYTES = 64 * 1024;
export const TEST_JUDGE_RESPONSE_BYTES = 1024 * 1024;
export const TEST_JUDGE_REQUEST_PREFIX = "test-judge-requests/";

const caseTextSchema = z.string().max(MAX_RUN_CASE_FIELD_LEN);

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

const checkerCasesSchema = z.array(testJudgeCheckerCaseSchema).min(1).max(TEST_JUDGE_MAX_CASES);
const interactiveCasesSchema = z
  .array(testJudgeInteractiveCaseSchema)
  .min(1)
  .max(TEST_JUDGE_MAX_CASES);

const encodedBytesSchema = z.object({ base64: z.base64() }).strict();

export const serialisedBuildArtifactSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("wasm"), bytes: encodedBytesSchema }),
  z.looseObject({
    kind: z.literal("runtime-bundle"),
    files: z.record(z.string(), z.union([z.string(), encodedBytesSchema])),
  }),
]);

export const storedJudgeProgramSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), artifact: serialisedBuildArtifactSchema }).strict(),
  z.object({ status: z.literal("failed"), diagnostics: z.string() }).strict(),
]);

export const testJudgeRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("checker"),
      context: submissionContextSchema,
      cases: checkerCasesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("interactive"),
      context: submissionContextSchema,
      language: languageSchema,
      artifact: serialisedBuildArtifactSchema,
      cases: interactiveCasesSchema,
    })
    .strict(),
]);

export const testJudgeVerdictSchema = z.enum(["AC", "WA", "TLE", "MLE", "RE", "SE"]);

export const testJudgeCaseResultSchema = z
  .object({
    verdict: testJudgeVerdictSchema,
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
  .object({ cases: z.array(testJudgeCaseResultSchema).max(TEST_JUDGE_MAX_CASES) })
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

const storedRequestBase = {
  judgeLanguage: judgeScriptLanguageSchema,
  judgeScriptPointer: storageObjectPointerSchema,
  timeLimitMs: z.number().int().positive(),
  memoryLimitMb: z.number().int().positive(),
  runtimeEnv: z.record(z.string(), z.string()),
};

export const testJudgeStoredRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("checker"),
      ...storedRequestBase,
      cases: checkerCasesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("interactive"),
      ...storedRequestBase,
      contestantLanguage: languageSchema,
      artifact: serialisedBuildArtifactSchema,
      cases: interactiveCasesSchema,
    })
    .strict(),
]);

export type TestJudgeRequest = z.infer<typeof testJudgeRequestSchema>;
export type TestJudgeVerdict = z.infer<typeof testJudgeVerdictSchema>;
export type TestJudgeCaseResult = z.infer<typeof testJudgeCaseResultSchema>;
export type TestJudgeResponse = z.infer<typeof testJudgeResponseSchema>;
export type TestJudgeErrorCode = (typeof testJudgeErrorCodes)[number];
export type TestJudgeStoredRequest = z.infer<typeof testJudgeStoredRequestSchema>;
export type EncodedBytes = z.infer<typeof encodedBytesSchema>;
export type SerialisedBuildArtifact = z.infer<typeof serialisedBuildArtifactSchema>;
export type StoredJudgeProgram = z.infer<typeof storedJudgeProgramSchema>;
