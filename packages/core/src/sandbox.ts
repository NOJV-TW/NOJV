import type { JudgeType, Language, SubmissionType } from "./domain";

export const sandboxVerdicts = ["AC", "WA", "TLE", "MLE", "RE", "SE"] as const;
export type SandboxVerdict = (typeof sandboxVerdicts)[number];

export interface SandboxConfig {
  submissionId: string;
  language: Language;
  judgeType: JudgeType;
  submissionType: SubmissionType;
  limits: {
    timeoutMs: number;
    memoryMb: number;
  };
  template?: {
    driverCode: string;
    insertionMarker: string;
  };
  checkerLanguage?: string;
  interactorLanguage?: string;
}

export interface SandboxTestcase {
  index: number;
  input: string;
  expected?: string;
  weight: number;
  isSample: boolean;
}

export interface SandboxRequest {
  submissionId: string;
  sourceCode: string;
  language: Language;
  submissionType: SubmissionType;
  testcases: SandboxTestcase[];
  judgeType: JudgeType;
  judgeConfig: {
    checkerScript?: string;
    interactorScript?: string;
    checkerLanguage?: string;
  };
  limits: {
    timeoutMs: number;
    memoryMb: number;
  };
  template?: {
    driverCode: string;
    insertionMarker: string;
  };
}

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
  testcaseResults: SandboxTestcaseResult[];
}

export interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

export const sourceFileNames: Record<Language, string> = {
  c: "main.c",
  cpp: "main.cpp",
  go: "main.go",
  java: "Main.java",
  javascript: "main.mjs",
  python: "main.py",
  rust: "main.rs",
  typescript: "main.ts"
};

export const sourceExtensions: Record<Language, string> = {
  c: "c",
  cpp: "cpp",
  go: "go",
  java: "java",
  javascript: "mjs",
  python: "py",
  rust: "rs",
  typescript: "ts"
};
