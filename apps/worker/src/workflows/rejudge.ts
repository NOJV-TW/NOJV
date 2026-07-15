import {
  ApplicationFailure,
  proxyActivities,
  defineQuery,
  setHandler,
  executeChild,
  isCancellation,
  log,
} from "@temporalio/workflow";
import type { RejudgeInput, RejudgeProgress, SubmissionJudgeDraft } from "@nojv/core";
import type * as judgeActivities from "../activities/judge";
import { submissionJudgeWorkflow } from "./submission-judge";
import { SHORT_ACTIVITY } from "./activity-options";
import { executeRejudgeBatches, RejudgeBatchError } from "./rejudge-batches";

const judge = proxyActivities<typeof judgeActivities>(SHORT_ACTIVITY);

export const getProgressQuery = defineQuery<RejudgeProgress>("getProgress");

export async function rejudgeWorkflow(input: RejudgeInput): Promise<void> {
  let completed = 0;
  let total = 0;
  setHandler(getProgressQuery, () => ({ completed, total }));

  let targets: { submissionId: string; draft: SubmissionJudgeDraft }[];
  if (input.mode === "single") {
    const one = await judge.fetchSingleSubmissionForRejudge(input.submissionId);
    targets = one ? [one] : [];
  } else {
    targets = await judge.fetchSubmissionIdsForRejudge(input);
  }

  total = targets.length;
  if (total === 0) return;

  const forRejudge = {
    triggeredByUserId: input.triggeredByUserId,
    ...(input.mode === "single" && input.expectedJudgeGeneration !== undefined
      ? { expectedJudgeGeneration: input.expectedJudgeGeneration }
      : {}),
  };

  try {
    await executeRejudgeBatches({
      targets,
      batchSize: 10,
      execute: async (sub) => {
        await executeChild(submissionJudgeWorkflow, {
          workflowId: `rejudge-${sub.submissionId}-${String(Date.now())}`,
          args: [{ submissionId: sub.submissionId, draft: sub.draft, forRejudge }],
        });
      },
      isCancellation,
      onCompleted: () => {
        completed++;
      },
      onFailure: (sub, error) => {
        log.error("rejudge child failed", {
          submissionId: sub.submissionId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  } catch (error) {
    if (!(error instanceof RejudgeBatchError)) throw error;
    throw ApplicationFailure.nonRetryable(
      error.message,
      "REJUDGE_CHILD_FAILURE",
      error.failedSubmissionIds,
    );
  }
}
