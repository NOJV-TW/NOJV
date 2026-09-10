import type { JudgeType, Language, ProblemType } from "./types";
import type { ProblemWorkspaceFile } from "./schemas/problem";
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

export const MAX_EXECUTION_OUTPUT_BYTES = 16 * 1024 * 1024;
export function executionWallTimeLimitMs(cpuTimeLimitMs: number): number {
  return cpuTimeLimitMs * 2;
}

export function validatorTimeoutMs(solutionTimeoutMs: number): number {
  return Math.max(30_000, solutionTimeoutMs);
}

export const COMPILATION_TIMEOUT_MS = 90_000;
export const COMPILER_SCRATCH_MB = 256;
export const MIN_COMPILER_MEMORY_MB = 512;

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

export function mergeWorkspaceSources(
  sources: readonly SandboxSourceFile[],
  workspaceFiles: readonly Pick<ProblemWorkspaceFile, "path" | "content" | "visibility">[],
): SandboxSourceFile[] {
  if (workspaceFiles.length === 0)
    return sources.map(({ path, content }) => ({ path, content }));
  const merged = new Map(workspaceFiles.map((file) => [file.path, file.content]));
  const editablePaths = new Set(
    workspaceFiles.filter((file) => file.visibility === "editable").map((file) => file.path),
  );
  for (const file of sources) {
    if (editablePaths.has(file.path)) merged.set(file.path, file.content);
  }
  return Array.from(merged, ([path, content]) => ({ path, content }));
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
