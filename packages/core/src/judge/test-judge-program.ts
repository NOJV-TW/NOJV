import type { JudgeScriptLanguage } from "../schemas/judge-config";
import { withCppPlatformHeaders } from "./cpp-standard-header";
import { pythonJudgeWrapper } from "./python-judge-wrappers";

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
