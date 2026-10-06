import { describe, expect, it } from "vitest";

import {
  TEST_JUDGE_MAX_CASES,
  storedJudgeProgramSchema,
  testJudgeCaseResultSchema,
  testJudgeRequestSchema,
  testJudgeResponseSchema,
  testJudgeStoredRequestSchema,
} from "@nojv/core";

const checkerCase = { sampleIndex: 0, output: "3\n" };

const checkerRequest = {
  kind: "checker",
  context: { type: "practice" },
  cases: [checkerCase],
};

const interactiveRequest = {
  kind: "interactive",
  context: { type: "practice" },
  language: "cpp",
  artifact: { kind: "wasm", language: "cpp", bytes: { base64: "AGFzbQ==" } },
  cases: [{ sampleIndex: 0 }],
};

describe("testJudgeRequestSchema", () => {
  it("accepts a minimal checker request", () => {
    expect(testJudgeRequestSchema.safeParse(checkerRequest).success).toBe(true);
  });

  it("accepts a minimal interactive request", () => {
    expect(testJudgeRequestSchema.safeParse(interactiveRequest).success).toBe(true);
  });

  it("accepts a runtime-bundle artifact with text and byte files", () => {
    const request = {
      ...interactiveRequest,
      language: "python",
      artifact: {
        kind: "runtime-bundle",
        entry: "main.py",
        files: { "main.py": "print(1)\n", "lib.pyc": { base64: "AQID" } },
      },
    };
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([
    { kind: "wasm", bytesBase64: "AGFzbQ==", metadata: { language: "cpp" } },
    { kind: "wasm", bytes: "AGFzbQ==" },
    { kind: "wasm", bytes: { base64: "not base64!" } },
    { kind: "wasm", bytes: { base64: "AGFzbQ==", extra: true } },
    { kind: "runtime-bundle", artifact: { kind: "runtime-bundle" } },
    { kind: "runtime-bundle", files: { "main.py": 1 } },
    { kind: "native", bytes: { base64: "AGFzbQ==" } },
  ])("rejects an artifact that is not in the shared wire format: %o", (artifact) => {
    const request = { ...interactiveRequest, artifact };
    expect(testJudgeRequestSchema.safeParse(request).success).toBe(false);
  });

  it("accepts every sample index once and rejects a sixth sample", () => {
    const withIndices = (indices: number[]) => ({
      ...checkerRequest,
      cases: indices.map((sampleIndex) => ({ sampleIndex, output: "" })),
    });
    expect(TEST_JUDGE_MAX_CASES).toBe(5);
    expect(testJudgeRequestSchema.safeParse(withIndices([0, 1, 2, 3, 4])).success).toBe(true);
    expect(testJudgeRequestSchema.safeParse(withIndices([5])).success).toBe(false);
    expect(testJudgeRequestSchema.safeParse(withIndices([-1])).success).toBe(false);
    expect(testJudgeRequestSchema.safeParse(withIndices([0.5])).success).toBe(false);
  });

  it("rejects a sample requested twice", () => {
    expect(
      testJudgeRequestSchema.safeParse({
        ...checkerRequest,
        cases: [checkerCase, { ...checkerCase, output: "4\n" }],
      }).success,
    ).toBe(false);
    expect(
      testJudgeRequestSchema.safeParse({
        ...interactiveRequest,
        cases: [{ sampleIndex: 1 }, { sampleIndex: 1 }],
      }).success,
    ).toBe(false);
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

  it.each([
    { kind: "checker", cases: [{ ...checkerCase, input: "1 2\n", expectedOutput: "3\n" }] },
    { kind: "checker", cases: [{ output: "3\n" }] },
    { kind: "interactive", cases: [{ sampleIndex: 0, interactorInput: "42\n" }] },
  ])("rejects client-supplied case data: %o", (override) => {
    const base = override.kind === "checker" ? checkerRequest : interactiveRequest;
    expect(testJudgeRequestSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("testJudgeCaseResultSchema", () => {
  it("rejects a judge message", () => {
    expect(
      testJudgeCaseResultSchema.safeParse({ verdict: "WA", judgeMessage: "x" }).success,
    ).toBe(false);
  });
});

describe("testJudgeResponseSchema", () => {
  it(`rejects more than ${String(TEST_JUDGE_MAX_CASES)} case results`, () => {
    const cases = Array.from({ length: TEST_JUDGE_MAX_CASES + 1 }, () => ({ verdict: "AC" }));
    expect(testJudgeResponseSchema.safeParse({ cases }).success).toBe(false);
  });
});

describe("testJudgeStoredRequestSchema", () => {
  const storedCheckerCase = { input: "1 2\n", expectedOutput: "3\n", output: "3\n" };
  const storedInteractiveCases = [{ interactorInput: "42\n" }];
  const storedBase = {
    judgeLanguage: "cpp",
    judgeScriptPointer: { key: "checkers/a.cpp", sha256: "a".repeat(64), size: 120 },
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    runtimeEnv: {},
  };
  const storedInteractive = {
    ...storedBase,
    kind: "interactive",
    contestantLanguage: "cpp",
    artifact: interactiveRequest.artifact,
    cases: storedInteractiveCases,
  };

  it("accepts a stored checker request", () => {
    const stored = { ...storedBase, kind: "checker", cases: [storedCheckerCase] };
    expect(testJudgeStoredRequestSchema.safeParse(stored).success).toBe(true);
  });

  it("accepts a stored interactive request", () => {
    expect(testJudgeStoredRequestSchema.safeParse(storedInteractive).success).toBe(true);
  });

  it("rejects a stored interactive request without an artifact", () => {
    const stored = { ...storedInteractive, artifact: undefined };
    expect(testJudgeStoredRequestSchema.safeParse(stored).success).toBe(false);
  });

  it("rejects a stored checker request carrying interactive cases", () => {
    const stored = { ...storedBase, kind: "checker", cases: storedInteractiveCases };
    expect(testJudgeStoredRequestSchema.safeParse(stored).success).toBe(false);
  });
});

describe("storedJudgeProgramSchema", () => {
  it("accepts a successful build and a failed build", () => {
    expect(
      storedJudgeProgramSchema.safeParse({
        status: "ok",
        artifact: interactiveRequest.artifact,
      }).success,
    ).toBe(true);
    expect(
      storedJudgeProgramSchema.safeParse({ status: "failed", diagnostics: "error" }).success,
    ).toBe(true);
  });

  it.each([
    { status: "ok" },
    { status: "ok", artifact: { kind: "wasm" } },
    { status: "failed" },
    { status: "pending", diagnostics: "" },
    { status: "failed", diagnostics: "error", artifact: interactiveRequest.artifact },
  ])("rejects %o", (record) => {
    expect(storedJudgeProgramSchema.safeParse(record).success).toBe(false);
  });
});
