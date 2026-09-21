import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
  PlagiarismCheckInput,
  RegistryGarbageCollectInput,
  RejudgeInput,
  RejudgeProgress,
  SubmissionJudgeJob,
} from "@nojv/core";

import { ConfigurationError } from "./errors";

export interface SubmissionJudgeState {
  status: string;
  running: boolean;
  lastActivityAt?: Date | null;
  pendingWorkflowTaskAt?: Date | null;
  hasPendingActivity?: boolean;
}

export interface DomainOrchestrationAdapter {
  cancelAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void>;
  cancelContestLifecycle(input: ContestLifecycleInput): Promise<void>;
  cancelExamAutoClose(input: ExamAutoCloseInput): Promise<void>;
  cancelRejudge(workflowId: string): Promise<void>;
  describeSubmissionJudge(
    submissionId: string,
    workflowId?: string,
  ): Promise<SubmissionJudgeState | null>;
  dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void>;
  dispatchRegistryGarbageCollect(
    input: RegistryGarbageCollectInput,
  ): Promise<{ workflowId: string; alreadyRunning: boolean }>;
  dispatchRejudge(input: RejudgeInput, workflowId: string): Promise<{ workflowId: string }>;
  dispatchJudgeCleanup(input: {
    executionId: string;
    workflowId: string;
    leaseToken: string;
  }): Promise<void>;
  dispatchJudgeExecution(input: { executionId: string; workflowId: string }): Promise<void>;
  dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void>;
  ensureAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void>;
  ensureContestLifecycle(input: ContestLifecycleInput): Promise<void>;
  ensureExamAutoClose(input: ExamAutoCloseInput): Promise<void>;
  probeTemporal(): Promise<void>;
  queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress | null>;
  replaceAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void>;
  replaceContestLifecycle(input: ContestLifecycleInput): Promise<void>;
  replaceExamAutoClose(input: ExamAutoCloseInput): Promise<void>;
  terminateSubmissionJudge(
    submissionId: string,
    reason: string,
    workflowId?: string,
  ): Promise<void>;
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
