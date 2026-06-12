import {
  cancelRejudge as temporalCancelRejudge,
  queryRejudgeProgress as temporalQueryRejudgeProgress,
} from "@nojv/temporal";

import { ForbiddenError } from "../shared/errors";

const REJUDGE_WORKFLOW_PREFIX = "rejudge-";

export function assertRejudgeWorkflowId(workflowId: string): void {
  if (!workflowId.startsWith(REJUDGE_WORKFLOW_PREFIX)) {
    throw new ForbiddenError("Not a rejudge workflow.");
  }
}

export async function cancelRejudge(workflowId: string): Promise<void> {
  assertRejudgeWorkflowId(workflowId);
  await temporalCancelRejudge(workflowId);
}

export async function queryRejudgeProgress(
  workflowId: string,
): ReturnType<typeof temporalQueryRejudgeProgress> {
  assertRejudgeWorkflowId(workflowId);
  return temporalQueryRejudgeProgress(workflowId);
}
