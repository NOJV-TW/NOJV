import manifest from "./judge-environment.json";
import { sourceFileNames } from "./sandbox";
import type { Language } from "./types";

export interface JudgeLanguageEnvironment {
  label: string;
  version: string;
  compileCommand: string | null;
  runCommand: string;
}

interface JudgeLanguageDefinition {
  label: string;
  version: { label: string; source: string };
  runCommand: string[];
}

type CompiledLanguage = Extract<Language, "c" | "cpp" | "go" | "java" | "rust">;
type DirectLanguage = Exclude<Language, CompiledLanguage>;

interface JudgeEnvironmentDefinition {
  platform: { name: string; version: string; nodeVersion: string };
  apkPackages: Record<string, string>;
  languages: Record<CompiledLanguage, JudgeLanguageDefinition & { compileCommand: string[] }> &
    Record<DirectLanguage, JudgeLanguageDefinition & { compileCommand: null }>;
}

export type JudgeCommandReplacements = Record<string, string | string[]>;

export const judgeEnvironmentDefinition: JudgeEnvironmentDefinition = manifest;

export function materializeJudgeCommand(
  template: string[],
  replacements: JudgeCommandReplacements,
): string[] {
  return template.flatMap((part) => {
    const replacement = replacements[part];
    if (replacement !== undefined) return replacement;
    if (part.startsWith("{") && part.endsWith("}")) {
      throw new Error(`Missing judge command replacement for ${part}.`);
    }
    return part;
  });
}

function pinnedVersion(source: string): string {
  if (source === "node") return judgeEnvironmentDefinition.platform.nodeVersion;
  if (!source.startsWith("apk:")) throw new Error(`Unknown judge version source: ${source}`);

  const packageName = source.slice(4);
  const version = judgeEnvironmentDefinition.apkPackages[packageName];
  if (!version) throw new Error(`Unknown judge APK package: ${packageName}`);
  return version.replace(/-r\d+$/, "").replace(/_p\d+$/, "");
}

function displayCommand(language: Language, template: string[], output: string): string {
  return materializeJudgeCommand(template, {
    "{output}": output,
    "{source}": sourceFileNames[language],
    "{sources}": "<sources>",
    "{sourceOrPackage}": "<source or package>",
    "{workDir}": ".",
  }).join(" ");
}

export const judgeEnvironment: {
  platform: JudgeEnvironmentDefinition["platform"];
  apkPackages: JudgeEnvironmentDefinition["apkPackages"];
  languages: Record<Language, JudgeLanguageEnvironment>;
} = {
  platform: judgeEnvironmentDefinition.platform,
  apkPackages: judgeEnvironmentDefinition.apkPackages,
  languages: Object.fromEntries(
    Object.entries(judgeEnvironmentDefinition.languages).map(([language, definition]) => [
      language,
      {
        label: definition.label,
        version: `${definition.version.label} ${pinnedVersion(definition.version.source)}`,
        compileCommand: definition.compileCommand
          ? displayCommand(language as Language, definition.compileCommand, "main")
          : null,
        runCommand: displayCommand(language as Language, definition.runCommand, "./main"),
      },
    ]),
  ) as Record<Language, JudgeLanguageEnvironment>,
};
