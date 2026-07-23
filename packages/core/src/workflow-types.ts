import type { SubmissionJudgeDraft } from "./schemas/submission";

export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionJudgeDraft;
  forRejudge?: { triggeredByUserId: string | null; expectedJudgeGeneration?: number };
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
      triggeredByUserId: string | null;
      expectedJudgeGeneration?: number;
    };

export interface RejudgeProgress {
  completed: number;
  total: number;
}

export interface LifecycleScheduleIdentity {
  scheduleRevision: number;
  timerFingerprint: string;
}

export interface ContestLifecycleInput extends LifecycleScheduleIdentity {
  contestId: string;
  startsAt: string;
  endsAt: string;
  frozenAt: string | null;
  scoreboardMode: "hidden" | "live" | "frozen";
}

export interface ExamAutoCloseInput extends LifecycleScheduleIdentity {
  examId: string;
  startsAt: string;
  endsAt: string;
}

export interface AssignmentDueSoonInput extends LifecycleScheduleIdentity {
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
