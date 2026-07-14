import type {
  AdvancedConfig,
  JudgeConfig,
  JudgeType,
  Language,
  ProblemOverview,
  ProblemStatus,
  ProblemType,
  ProblemVisibility,
  SubmissionContext,
  SubmissionResult,
} from "@nojv/core";

export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
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
  judgeConfig: JudgeConfig;
  judgeType: JudgeType;
  memoryLimitMb: number;
  outputFormat: string;
  type: ProblemType;
  samples: {
    input: string;
    output: string;
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
