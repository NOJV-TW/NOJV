import type {
  JudgeConfig,
  JudgeType,
  Language,
  ProblemImageSource,
  ProblemOverview,
  ProblemStatus,
  ProblemType,
  ProblemVisibility,
  SubmissionResult,
} from "@nojv/core";

export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
  result: SubmissionResult;
  sourceCode?: string;
  submittedAt: string;
  context?: "practice" | "assignment" | "contest" | "exam";
}

export interface ProblemEditorialEntry {
  id: string;
  content: string;
  language: string;
  createdAt: string;
  user: { username: string | null; name: string };
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
  visibility: ProblemVisibility;
  advancedImageRef: string | null;
  advancedImageSource: ProblemImageSource | null;
  advancedRequiredPaths: string[];
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
}
