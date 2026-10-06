import type { JudgeScriptLanguage } from "../schemas/judge-config";
import { withCppPlatformHeaders } from "./cpp-standard-header";
import { pythonJudgeWrapper } from "./python-judge-wrappers";

export const WASM_OJ_SERVER_VERSIONS = {
  server: "0.2.3",
  clang: "0.2.0",
  python: "0.2.0",
} as const;

export const WASM_OJ_SERVER_IDENTITY = `wasm-oj-server@${WASM_OJ_SERVER_VERSIONS.server}+clang@${WASM_OJ_SERVER_VERSIONS.clang}+python@${WASM_OJ_SERVER_VERSIONS.python}`;

export type JudgeProgramRole = "checker" | "interactor";

export interface JudgeProgramSource {
  role: JudgeProgramRole;
  language: JudgeScriptLanguage;
  source: string;
}

interface JudgeProgramCompileInput {
  language: JudgeScriptLanguage;
  entry: string;
  files: Record<string, string>;
}

const CACHE_KEY_PCH_HEADER = "<wasm-oj-pch>";

export function judgeProgramCompileInput(
  { role, language, source }: JudgeProgramSource,
  pchHeader: string,
): JudgeProgramCompileInput {
  if (language === "python") {
    return {
      language,
      entry: "main.py",
      files: { "main.py": `${pythonJudgeWrapper(role)}${source}` },
    };
  }
  return {
    language,
    entry: "main.cpp",
    files: withCppPlatformHeaders({ "main.cpp": source }, pchHeader),
  };
}

export async function testJudgeProgramCacheKey(program: JudgeProgramSource): Promise<string> {
  const payload = JSON.stringify([
    WASM_OJ_SERVER_IDENTITY,
    JSON.stringify(judgeProgramCompileInput(program, CACHE_KEY_PCH_HEADER)),
  ]);
  const data = new TextEncoder().encode(payload);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
