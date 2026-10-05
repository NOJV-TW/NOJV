import type { JudgeScriptLanguage } from "../schemas/judge-config";
import type { JudgeType, Language } from "../types";

export const WASM_OJ_SERVER_IDENTITY = "wasm-oj-server@0.2.3+clang@0.2.0+python@0.2.0";

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
  // ponytail: Python interactors wait for the wasm-oj/forge runtime-bundle-interactor release
  if (input.judgeType === "interactive" && input.judgeLanguage === "python") {
    return { available: false, reason: "judge_program_unsupported" };
  }
  return { available: true };
}

export function interactiveContestantSupported(language: Language): boolean {
  return language !== "javascript" && language !== "typescript";
}

export async function testJudgeProgramCacheKey(input: {
  role: "checker" | "interactor";
  language: JudgeScriptLanguage;
  source: string;
}): Promise<string> {
  const payload = JSON.stringify([
    WASM_OJ_SERVER_IDENTITY,
    input.role,
    input.language,
    input.source,
  ]);
  const data = new TextEncoder().encode(payload);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
