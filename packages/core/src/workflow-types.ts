import type { SubmissionDraft } from "./schemas/submission";

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
      since?: string;
      until?: string;
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

export interface ExamAutoCloseInput {
  examId: string;
  startsAt: string;
  endsAt: string;
}

export interface AssignmentDueSoonInput {
  assignmentId: string;
  opensAt: string;
  closesAt: string;
}

export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "assessment" | "exam" | "contest";
  triggeredById: string;
}

export interface RegistryGarbageCollectInput {
  triggeredByUserId: string;
}

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";
