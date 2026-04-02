import { proxyActivities, defineQuery, setHandler, executeChild } from "@temporalio/workflow";
import type { RejudgeInput, RejudgeProgress } from "../types";
import type * as judgeActivities from "../activities/judge";
import { submissionJudgeWorkflow } from "./submission-judge";
import { JUDGE_TASK_QUEUE } from "../task-queues";

const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 }
});

export const getProgressQuery = defineQuery<RejudgeProgress>("getProgress");

export async function rejudgeWorkflow(input: RejudgeInput): Promise<void> {
  let completed = 0;
  let total = 0;
  setHandler(getProgressQuery, () => ({ completed, total }));

  // 1. Fetch submission IDs to rejudge
  const submissionIds = await judge.fetchSubmissionIdsForRejudge(input);

  total = submissionIds.length;
  if (total === 0) return;

  // 2. Fan out child workflows with controlled concurrency
  const BATCH_SIZE = 10;
  for (let i = 0; i < submissionIds.length; i += BATCH_SIZE) {
    const batch = submissionIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (sub) => {
        await executeChild(submissionJudgeWorkflow, {
          workflowId: `rejudge-${sub.submissionId}`,
          taskQueue: JUDGE_TASK_QUEUE,
          args: [{ submissionId: sub.submissionId, draft: sub.draft }]
        });
        completed++;
      })
    );
  }
}
