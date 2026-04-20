import type { JudgeType, Language, ProblemType } from "./types";

// --- Sandbox request ---

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

/**
 * Optional payload supplied when the submission is for an advanced-mode
 * problem (TA-provided judge container). When set, the runner skips the
 * standard pipeline and instead invokes the configured image with the
 * v2 container contract: student files under `/workspace/submission/`,
 * image writes its score to `/workspace/output/result.json`.
 */
export interface SandboxAdvancedRequest {
  imageRef: string;
  imageSource: "registry" | "tarball";
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
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
  };
  advanced?: SandboxAdvancedRequest;
}

// --- Sandbox result ---

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxTestcaseResult {
  index: number;
  verdict: SandboxVerdict;
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  score?: number;
  feedback?: string;
}

export interface SandboxResult {
  compilationError?: string;
  pipelineError?: string;
  testcaseResults: SandboxTestcaseResult[];
  customScore?: number;
  scoringFeedback?: string;
}

export interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

// --- Path security ---

/** Normalize a relative file path, rejecting traversal attacks and invalid segments. */
export function normalizeRelativePath(rawPath: string): string | null {
  const normalized = rawPath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/")) return null;

  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (
    segments.length === 0 ||
    segments.some((s) => s === "." || s === ".." || s.includes("\0") || s.includes(":"))
  ) {
    return null;
  }

  return segments.join("/");
}

// --- Language file mapping ---

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
