export interface SandboxExecutor {
  execute(request: SandboxRequest): Promise<SandboxResult>;
}

export interface SandboxRequest {
  submissionId: string;
  sourceCode: string;
  language: "c" | "cpp" | "go" | "java" | "javascript" | "python" | "rust" | "typescript";
  submissionType: "function" | "full_source";
  testcases: {
    index: number;
    input: string;
    expected?: string;
    weight: number;
    isSample: boolean;
  }[];
  judgeType: "standard" | "checker" | "interactive";
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

export interface SandboxResult {
  compilationError?: string;
  testcaseResults: {
    index: number;
    verdict: "AC" | "WA" | "TLE" | "MLE" | "RE" | "SE";
    stdout: string;
    stderr: string;
    exitCode: number;
    timeMs: number;
    score?: number;
    feedback?: string;
  }[];
}
