import type { SubmissionDraft } from "@nojv/core";

export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
  /** Present only when dispatched via rejudgeWorkflow; drives the
   *  snapshot/finalize audit hooks in submissionJudgeWorkflow. */
  forRejudge?: { triggeredByUserId: string };
}

export type SubmissionJudgeStatus = "queued" | "compiling" | "running" | "completed" | "failed";

export type RejudgeInput =
  | {
      mode: "batch";
      problemId: string;
      contestId?: string;
      assessmentId?: string;
      examId?: string;
      userIds?: string[];
      since?: string; // ISO date
      until?: string; // ISO date
      triggeredByUserId: string;
    }
  | {
      mode: "single";
      submissionId: string;
      triggeredByUserId: string;
    };

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
  // Passed as strings so the Temporal payload is deterministic across SDK serializers.
  startsAt: string;
  endsAt: string;
}

// `(targetType, targetId)` is the plagiarism report identity (state is inline on the target row).
export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "courseAssessment" | "exam" | "contest";
  triggeredById: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
