import type {
  AdjustmentRules,
  AdvancedConfig,
  CompareConfig,
  JudgeType,
  ProblemJudgeTestcase,
  ProblemSample,
  ProblemType,
  Runtime,
  WorkspaceFileVisibility,
} from "@nojv/core";

export interface TestcaseSetGroup {
  id: string;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface WorkspaceFileEntry {
  content: string;
  language: string;
  path: string;
  visibility: WorkspaceFileVisibility;
}

export interface AdjustmentContext {
  assignmentAdjustmentRules: AdjustmentRules | null;
  dueAt: Date | null;
  finalDay: Date | null;
  submittedAt: Date;
}

export interface AdvancedModeContext {
  config: AdvancedConfig;
  requiredPaths: string[];
  resourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
  };
}

export interface SubmissionJudgeContext {
  adjustment: AdjustmentContext;
  checkerScript: string | null;
  interactorScript: string | null;
  compareOptions: CompareConfig | null;
  judgeType: JudgeType;
  runtime: Runtime;
  samples: ProblemSample[];
  problemType: ProblemType;
  testcaseSets: TestcaseSetGroup[];
  workspaceFiles: WorkspaceFileEntry[];
  advanced: AdvancedModeContext | null;
}

export interface CompletedSubmission {
  contestId: string | null;
  examId: string | null;
  createdAt: Date;
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  score: number;
  status: string;
  userId: string;
}
