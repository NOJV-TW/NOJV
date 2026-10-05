import { describe, expect, it } from "vitest";

import {
  TEST_JUDGE_MAX_CASES,
  testJudgeCaseResultSchema,
  testJudgeRequestSchema,
  testJudgeStoredRequestSchema,
} from "@nojv/core";

const checkerCase = { input: "1 2\n", expectedOutput: "3\n", output: "3\n" };

const checkerRequest = {
  kind: "checker",
  context: { type: "practice" },
  cases: [checkerCase],
};

const interactiveRequest = {
  kind: "interactive",
  context: { type: "practice" },
  language: "cpp",
  artifact: { kind: "wasm", bytesBase64: "AGFzbQ==", metadata: { language: "cpp" } },
  cases: [{ interactorInput: "42\n" }],
};

describe("testJudgeRequestSchema", () => {
  it("accepts a minimal checker request", () => {
    expect(testJudgeRequestSchema.safeParse(checkerRequest).success).toBe(true);
  });

  it("accepts a minimal interactive request", () => {
    expect(testJudgeRequestSchema.safeParse(interactiveRequest).success).toBe(true);
  });

  it("accepts a runtime-bundle artifact", () => {
    const request = {
      ...interactiveRequest,
      language: "python",
      artifact: { kind: "runtime-bundle", artifact: { kind: "runtime-bundle" } },
    };
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(true);
  });

  it(`rejects more than ${String(TEST_JUDGE_MAX_CASES)} cases`, () => {
    const request = {
      ...checkerRequest,
      cases: Array.from({ length: TEST_JUDGE_MAX_CASES + 1 }, () => checkerCase),
    };
    expect(TEST_JUDGE_MAX_CASES).toBe(15);
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects an empty case list", () => {
    expect(testJudgeRequestSchema.safeParse({ ...checkerRequest, cases: [] }).success).toBe(
      false,
    );
  });

  it("rejects unknown keys on the request and on a case", () => {
    expect(
      testJudgeRequestSchema.safeParse({ ...checkerRequest, problemId: "p" }).success,
    ).toBe(false);
    expect(
      testJudgeRequestSchema.safeParse({
        ...checkerRequest,
        cases: [{ ...checkerCase, judgeMessage: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects an interactive request without an artifact", () => {
    const request = { ...interactiveRequest, artifact: undefined };
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects a checker case without expectedOutput", () => {
    const request = { ...checkerRequest, cases: [{ input: "1 2\n", output: "3\n" }] };
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe("testJudgeCaseResultSchema", () => {
  it("rejects a judge message", () => {
    expect(
      testJudgeCaseResultSchema.safeParse({ verdict: "WA", judgeMessage: "x" }).success,
    ).toBe(false);
  });
});

describe("testJudgeStoredRequestSchema", () => {
  it("accepts a stored checker request", () => {
    const stored = {
      kind: "checker",
      judgeLanguage: "cpp",
      judgeScriptPointer: { key: "checkers/a.cpp", sha256: "a".repeat(64), size: 120 },
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      runtimeEnv: {},
      checkerCases: [checkerCase],
    };
    expect(testJudgeStoredRequestSchema.safeParse(stored).success).toBe(true);
  });
});
