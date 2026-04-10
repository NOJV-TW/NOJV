import type { SubmissionDraft } from "@nojv/core";

// SubmissionJudgeWorkflow
export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
}

export type SubmissionJudgeStatus = "queued" | "compiling" | "running" | "completed" | "failed";

// RejudgeWorkflow
export interface RejudgeInput {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}

export interface RejudgeProgress {
  completed: number;
  total: number;
}

// ContestLifecycleWorkflow
export interface ContestLifecycleInput {
  contestId: string;
}

export type AdminOverrideSignal =
  | { action: "earlyEnd" }
  | { action: "extend"; newEndsAt: string };

// AssessmentLifecycleWorkflow
export interface AssessmentLifecycleInput {
  assessmentId: string;
}

// PlagiarismCheckWorkflow
//
// The `PlagiarismReport` table was removed in the second-pass refactor, so
// `(targetType, targetId)` is now the report identity. `triggeredById` is
// still carried in the workflow input so the activity can record who
// kicked the scan off on the parent row.
export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "courseAssessment" | "contest";
  triggeredById: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
