import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CPP_STANDARD_HEADER_INCLUDES,
  PYTHON_INTERACTOR_WRAPPER,
  PYTHON_VALIDATOR_WRAPPER,
  interactiveContestantSupported,
  pythonJudgeWrapper,
  staticTestCapability,
  supportedLanguages,
  testJudgeProgramCacheKey,
  testJudgeProgramObjectKey,
  WASM_OJ_SERVER_IDENTITY,
  type Language,
} from "@nojv/core";

describe("staticTestCapability", () => {
  it.each([
    { judgeType: "standard", judgeLanguage: null, testJudgeEnabled: true },
    { judgeType: "checker", judgeLanguage: "cpp", testJudgeEnabled: false },
    { judgeType: "interactive", judgeLanguage: "python", testJudgeEnabled: true },
  ] as const)("reports special_env before any other rule for $judgeType", (input) => {
    expect(staticTestCapability({ isSpecialEnv: true, ...input })).toEqual({
      available: false,
      reason: "special_env",
    });
  });

  it.each([true, false])(
    "keeps standard problems available when the test judge is %s",
    (enabled) => {
      expect(
        staticTestCapability({
          isSpecialEnv: false,
          judgeType: "standard",
          judgeLanguage: null,
          testJudgeEnabled: enabled,
        }),
      ).toEqual({ available: true });
    },
  );

  it.each([
    { judgeType: "checker", judgeLanguage: "cpp" },
    { judgeType: "checker", judgeLanguage: "python" },
    { judgeType: "interactive", judgeLanguage: "cpp" },
    { judgeType: "interactive", judgeLanguage: "python" },
  ] as const)(
    "reports test_judge_unavailable for $judgeType/$judgeLanguage when the test judge is off",
    (input) => {
      expect(
        staticTestCapability({ isSpecialEnv: false, testJudgeEnabled: false, ...input }),
      ).toEqual({ available: false, reason: "test_judge_unavailable" });
    },
  );

  it("reports judge_program_unsupported for a Python interactor", () => {
    expect(
      staticTestCapability({
        isSpecialEnv: false,
        judgeType: "interactive",
        judgeLanguage: "python",
        testJudgeEnabled: true,
      }),
    ).toEqual({ available: false, reason: "judge_program_unsupported" });
  });

  it.each([
    { judgeType: "checker", judgeLanguage: "cpp" },
    { judgeType: "checker", judgeLanguage: "python" },
    { judgeType: "interactive", judgeLanguage: "cpp" },
  ] as const)(
    "keeps $judgeType/$judgeLanguage available when the test judge is on",
    (input) => {
      expect(
        staticTestCapability({ isSpecialEnv: false, testJudgeEnabled: true, ...input }),
      ).toEqual({ available: true });
    },
  );
});

describe("interactiveContestantSupported", () => {
  const expected: Record<Language, boolean> = {
    c: true,
    cpp: true,
    go: true,
    java: true,
    javascript: false,
    python: true,
    rust: true,
    typescript: false,
  };

  it.each(supportedLanguages)("%s", (language) => {
    expect(interactiveContestantSupported(language)).toBe(expected[language]);
  });
});

describe("testJudgeProgramCacheKey", () => {
  const base = { role: "checker", language: "cpp", source: "int main() {}" } as const;

  it.each([
    ["checker", "cpp", CPP_STANDARD_HEADER_INCLUDES],
    ["interactor", "cpp", CPP_STANDARD_HEADER_INCLUDES],
    ["checker", "python", PYTHON_VALIDATOR_WRAPPER],
    ["interactor", "python", PYTHON_INTERACTOR_WRAPPER],
  ] as const)(
    "hashes the toolchain identity, role, language, NOJV build input and source (%s, %s)",
    async (role, language, platformSource) => {
      const input = { role, language, source: base.source };
      const expected = createHash("sha256")
        .update(
          JSON.stringify([
            WASM_OJ_SERVER_IDENTITY,
            role,
            language,
            platformSource,
            base.source,
          ]),
        )
        .digest("hex");

      const key = await testJudgeProgramCacheKey(input);

      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).toBe(expected);
      expect(await testJudgeProgramCacheKey({ ...input })).toBe(key);
    },
  );

  it.each([
    { role: "interactor" },
    { language: "python" },
    { source: "int main() { return 0; }" },
  ] as const)("changes when %o changes", async (change) => {
    expect(await testJudgeProgramCacheKey({ ...base, ...change })).not.toBe(
      await testJudgeProgramCacheKey(base),
    );
  });
});

describe("pythonJudgeWrapper", () => {
  it("gives checkers the validator wrapper and interactors the interactor wrapper", () => {
    expect(pythonJudgeWrapper("checker")).toBe(PYTHON_VALIDATOR_WRAPPER);
    expect(pythonJudgeWrapper("interactor")).toBe(PYTHON_INTERACTOR_WRAPPER);
  });
});

describe("testJudgeProgramObjectKey", () => {
  it("stores programs under the versioned test-judge prefix", () => {
    expect(testJudgeProgramObjectKey("ab12")).toBe("test-judge-programs/v1/ab12.json");
  });
});
