import { z } from "zod";
import { judgeScriptLanguageSchema, type JudgeScriptLanguage } from "../schemas/judge-config";
import { withCppPlatformHeaders } from "./cpp-standard-header";
import { pythonJudgeWrapper } from "./python-judge-wrappers";

const judgeProgramRoleSchema = z.enum(["checker", "interactor"]);

export type JudgeProgramRole = z.infer<typeof judgeProgramRoleSchema>;

export interface JudgeProgramSource {
  role: JudgeProgramRole;
  language: JudgeScriptLanguage;
  source: string;
}

export const judgeProgramSourceViewSchema = z.object({
  role: judgeProgramRoleSchema,
  language: judgeScriptLanguageSchema,
  source: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type JudgeProgramSourceView = z.infer<typeof judgeProgramSourceViewSchema>;

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
