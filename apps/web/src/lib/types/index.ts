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

// `id` is absent for local-only entries added before server persistence; when present, source is lazily fetched.
export interface ProblemSubmissionEntry {
  id?: string;
  language: string;
  result: SubmissionResult;
  sourceCode?: string;
  submittedAt: string;
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
  /** Practice page only — undefined elsewhere (contest/exam/assignment). */
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
  // Hidden files have `content === ""`; the domain layer blanks them before they leave the server.
  workspaceFiles: {
    language: string;
    path: string;
    content: string;
    visibility: "editable" | "readonly" | "hidden";
    description: string;
  }[];
}
