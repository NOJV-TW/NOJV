import type { JudgeType, Language, ProblemType } from "./types";
import type { AdvancedConfig } from "./schemas/advanced-mode";
import type { CompareConfig } from "./schemas/judge-config";
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
    checkerLanguage?: string;
    interactorLanguage?: string;
    compare?: CompareConfig;
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
    env?: Record<string, string>;
  };
  advanced?: SandboxAdvancedRequest;
}

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxTestcaseResult {
  index: number;
  verdict: SandboxVerdict;
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  memoryKb?: number;
  feedback?: string;
  staffFeedback?: string;
}

export interface RawCaseRun {
  index: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  memoryKb?: number;
  errorVerdict?: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE">;
}

export interface SandboxResult {
  compilationError?: string;
  pipelineError?: string;
  testcaseResults: SandboxTestcaseResult[];
  rawRuns?: RawCaseRun[];
  customScore?: number;
  scoringFeedback?: string;
  overallVerdict?: SandboxVerdict;
}

export interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

export interface ContainerMemoryOptions {
  defaultMemoryMb: number;
  headroomMb: number;
  maxMemoryMb: number;
}

export const DEFAULT_MEMORY_HEADROOM_MB = 64;
export const DEFAULT_MAX_MEMORY_MB = 2048;

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
