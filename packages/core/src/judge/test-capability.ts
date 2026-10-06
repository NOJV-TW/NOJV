import type { JudgeScriptLanguage } from "../schemas/judge-config";
import type { JudgeType, Language } from "../types";

export type TestCapability =
  | { available: true }
  | {
      available: false;
      reason: "special_env" | "test_judge_unavailable" | "judge_program_unsupported";
    };

export function staticTestCapability(input: {
  isSpecialEnv: boolean;
  judgeType: JudgeType;
  judgeLanguage: JudgeScriptLanguage | null;
  testJudgeEnabled: boolean;
}): TestCapability {
  if (input.isSpecialEnv) return { available: false, reason: "special_env" };
  if (input.judgeType === "standard") return { available: true };
  if (!input.testJudgeEnabled) return { available: false, reason: "test_judge_unavailable" };
  if (input.judgeLanguage === null) {
    return { available: false, reason: "judge_program_unsupported" };
  }
  // ponytail: Python interactors wait for the wasm-oj/forge runtime-bundle-interactor release
  if (input.judgeType === "interactive" && input.judgeLanguage === "python") {
    return { available: false, reason: "judge_program_unsupported" };
  }
  return { available: true };
}

export function interactiveContestantSupported(language: Language): boolean {
  return language !== "javascript" && language !== "typescript";
}
