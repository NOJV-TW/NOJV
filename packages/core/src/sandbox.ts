import type { JudgeType, Language, ProblemType } from "./types";
import type { AdvancedConfig } from "./schemas/advanced-mode";
import type { z } from "zod";
import type {
  rawCaseRunSchema,
  sandboxOutputSchema,
  sandboxTestcaseResultSchema,
} from "./schemas/sandbox-output";
import type { sandboxVerdicts } from "./schemas/sandbox-output";
export { sandboxVerdicts } from "./schemas/sandbox-output";
import type { CompareConfig, JudgeScriptLanguage } from "./schemas/judge-config";
import { parseRelativePath } from "./schemas/path";

export interface SandboxTestcase {
  index: number;
  input: string;
  output?: string;
  weight: number;
  isSample: boolean;
}

export interface SandboxSourceFile {
  path: string;
  content: string;
}

export interface SandboxAdvancedRequest {
  run: AdvancedConfig["run"];
  grade: AdvancedConfig["grade"];
  network: AdvancedConfig["network"];
  totalTimeMs: number;
  memoryMb: number;
  maxScore: number;
}

export interface SandboxRequest {
  submissionId: string;
  sourceCode: string;
  sourceFiles?: SandboxSourceFile[];
  entryFile?: string;
  language: Language;
  problemType: ProblemType;
  testcases: SandboxTestcase[];
  judgeType: JudgeType;
  judgeConfig: {
    checkerScript?: string;
    interactorScript?: string;
    checkerLanguage?: JudgeScriptLanguage;
    interactorLanguage?: JudgeScriptLanguage;
    compare?: CompareConfig;
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
    env?: Record<string, string>;
  };
  advanced?: SandboxAdvancedRequest;
}

export type SandboxVerdict = (typeof sandboxVerdicts)[number];
export type SandboxTestcaseResult = z.infer<typeof sandboxTestcaseResultSchema>;
export type RawCaseRun = z.infer<typeof rawCaseRunSchema>;
export type SandboxResult = z.infer<typeof sandboxOutputSchema>;

export interface SandboxExecutionContext {
  runId: string;
  signal: AbortSignal;
}

export interface SandboxExecutor {
  execute(request: SandboxRequest, execution: SandboxExecutionContext): Promise<SandboxResult>;
}

export interface ContainerMemoryOptions {
  defaultMemoryMb: number;
  headroomMb: number;
  maxMemoryMb: number;
}

export const DEFAULT_MEMORY_HEADROOM_MB = 64;
export const DEFAULT_MAX_MEMORY_MB = 1536;

export function resolveContainerMemoryMb(
  perProblemMemoryMb: number | undefined,
  options: ContainerMemoryOptions,
): number {
  const base = perProblemMemoryMb ?? options.defaultMemoryMb;
  const withHeadroom = base + options.headroomMb;
  return Math.max(base, Math.min(withHeadroom, options.maxMemoryMb));
}

export function normalizeRelativePath(rawPath: string): string {
  return parseRelativePath(rawPath);
}

export const sourceFileNames: Record<Language, string> = {
  c: "main.c",
  cpp: "main.cpp",
  go: "main.go",
  java: "Main.java",
  javascript: "main.mjs",
  python: "main.py",
  rust: "main.rs",
  typescript: "main.ts",
};

export const sourceExtensions: Record<Language, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "mjs",
  python: "py",
  rust: "rs",
  typescript: "ts",
};
