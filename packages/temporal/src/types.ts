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
export interface PlagiarismCheckInput {
  reportId: string;
  targetId: string;
  targetType: "courseAssessment" | "contest";
  triggeredById: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
