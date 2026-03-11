import type { JudgeType, Language, SubmissionType } from "@nojv/core";

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
