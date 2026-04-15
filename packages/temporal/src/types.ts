import type { SubmissionDraft } from "@nojv/core";

export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
}

export type SubmissionJudgeStatus = "queued" | "compiling" | "running" | "completed" | "failed";

export interface RejudgeInput {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}

export interface RejudgeProgress {
  completed: number;
  total: number;
}

export interface ContestLifecycleInput {
  contestId: string;
}

export type AdminOverrideSignal =
  | { action: "earlyEnd" }
  | { action: "extend"; newEndsAt: string };

export interface AssessmentLifecycleInput {
  assessmentId: string;
}

export interface ExamAutoCloseInput {
  examId: string;
  // Passed as a string so the Temporal payload is deterministic across SDK serializers.
  endsAt: string;
}

// `(targetType, targetId)` is the plagiarism report identity (state is inline on the target row).
export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "courseAssessment" | "exam";
  triggeredById: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
