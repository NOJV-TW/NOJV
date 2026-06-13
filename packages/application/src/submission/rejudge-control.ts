import type { RejudgeInput, RejudgeProgress, SubmissionJudgeJob } from "@nojv/core";

import { ForbiddenError } from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";

const REJUDGE_WORKFLOW_PREFIX = "rejudge-";

export function assertRejudgeWorkflowId(workflowId: string): void {
  if (!workflowId.startsWith(REJUDGE_WORKFLOW_PREFIX)) {
    throw new ForbiddenError("Not a rejudge workflow.");
  }
}

export async function cancelRejudge(workflowId: string): Promise<void> {
  assertRejudgeWorkflowId(workflowId);
  await getDomainOrchestration().cancelRejudge(workflowId);
}

export async function queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress> {
  assertRejudgeWorkflowId(workflowId);
  return getDomainOrchestration().queryRejudgeProgress(workflowId);
}

export async function dispatchRejudge(input: RejudgeInput): Promise<{ workflowId: string }> {
  return getDomainOrchestration().dispatchRejudge(input);
}

export async function dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void> {
  await getDomainOrchestration().dispatchSubmissionJudge(payload);
}
