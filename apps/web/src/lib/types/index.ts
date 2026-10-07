import type {
  AdvancedConfig,
  CaseResult,
  JudgeConfig,
  JudgeType,
  Language,
  ProblemOverview,
  ProblemStatus,
  ProblemType,
  ProblemVisibility,
  SubmissionContext,
  SubmissionResult,
  SubmissionOperationStatus,
} from "@nojv/core";

export interface TestCaseView extends CaseResult {
  executionOnly?: true;
  serverJudged?: true;
  teamMessage?: string;
  transcript?: { toInteractor: string; toContestant: string };
}

export interface TestRunResult extends SubmissionResult {
  caseResults?: TestCaseView[] | undefined;
  serverNotice?: string | undefined;
}

export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
  status: SubmissionOperationStatus;
  judgeGeneration: number;
  updatedAt: string;
  result?: SubmissionResult;
  sourceCode?: string;
  submittedAt: string;
  context?: SubmissionContext["type"];
}

export interface ProblemTestcaseSetSummary {
  id: string;
  name: string;
  description: string;
  weight: number;
  ordinal: number;
  caseCount: number;
}

export interface ProblemDetail extends ProblemOverview {
  authorUsername: string;
  bookmarked?: boolean;
  inputFormat: string;
  interactionFormat: string;
  judgeConfig: JudgeConfig;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  type: ProblemType;
  samples: {
    input: string;
    output: string;
    explanation?: string | undefined;
    interactorInput?: string | undefined;
  }[];
  starterByLanguage: Record<Language, string>;
  statement: string;
  status: ProblemStatus;
  tags: string[];
  timeLimitMs: number;
  totalScore: number;
  visibility: ProblemVisibility;
  advancedConfig: AdvancedConfig | null;
  advancedRequiredPaths: string[];
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
}
