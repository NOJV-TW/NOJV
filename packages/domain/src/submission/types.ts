import type { SubtaskScoringStrategy } from "@nojv/db";
import type {
  AdjustmentRules,
  JudgeType,
  ProblemImageSource,
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

export type SubtaskStrategyMap = Record<string, SubtaskScoringStrategy>;

export interface AdjustmentContext {
  assignmentAdjustmentRules: AdjustmentRules | null;
  dueAt: Date | null;
  /** Hard close of the owning assignment — used by `flat_late_penalty` / `daily_late_penalty` (`startFrom: "final_day"`) and by `final_day_zero`. */
  finalDay: Date | null;
  submittedAt: Date;
}

export interface AdvancedModeContext {
  imageRef: string;
  imageSource: ProblemImageSource;
  resourceLimits: {
    totalTimeMs: number;
    memoryMb: number;
  };
}

export interface SubmissionJudgeContext {
  adjustment: AdjustmentContext;
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  runtime: Runtime;
  samples: ProblemSample[];
  problemType: ProblemType;
  subtaskStrategies: SubtaskStrategyMap;
  testcaseSets: TestcaseSetGroup[];
  workspaceFiles: WorkspaceFileEntry[];
  /** Non-null only when `problemType === "special_env"`. */
  advanced: AdvancedModeContext | null;
}

export interface CompletedSubmission {
  contestParticipationId: string | null;
  createdAt: Date;
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  score: number;
  status: string;
  userId: string;
}
