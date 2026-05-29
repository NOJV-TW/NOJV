import type { SubmissionDraft } from "@nojv/core";

export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
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

export interface ExamAutoCloseInput {
  examId: string;
  startsAt: string;
  endsAt: string;
}

export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "courseAssessment" | "exam" | "contest";
  triggeredById: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
