import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
  PlagiarismCheckInput,
  RejudgeInput,
  RejudgeProgress,
  SubmissionJudgeJob,
} from "@nojv/core";

import { ConfigurationError } from "./errors";

export interface SubmissionJudgeState {
  status: string;
  running: boolean;
}

export interface DomainOrchestrationAdapter {
  cancelRejudge(workflowId: string): Promise<void>;
  describeSubmissionJudge(submissionId: string): Promise<SubmissionJudgeState | null>;
  dispatchAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void>;
  dispatchContestLifecycle(input: ContestLifecycleInput): Promise<void>;
  dispatchExamAutoClose(input: ExamAutoCloseInput): Promise<void>;
  dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void>;
  dispatchRejudge(input: RejudgeInput): Promise<{ workflowId: string }>;
  dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void>;
  probeTemporal(): Promise<void>;
  queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress>;
  terminateSubmissionJudge(submissionId: string, reason: string): Promise<void>;
}

let adapter: DomainOrchestrationAdapter | null = null;

export function configureDomainOrchestration(next: DomainOrchestrationAdapter): void {
  adapter = next;
}

export function getDomainOrchestration(): DomainOrchestrationAdapter {
  if (!adapter) {
    throw new ConfigurationError("Domain orchestration adapter is not configured.");
  }
  return adapter;
}
