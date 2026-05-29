import { proxyActivities, defineQuery, setHandler, executeChild } from "@temporalio/workflow";
import type { SubmissionDraft } from "@nojv/core";
import type { RejudgeInput, RejudgeProgress } from "@nojv/temporal";
import type * as judgeActivities from "../activities/judge";
import { submissionJudgeWorkflow } from "./submission-judge";
import { SHORT_ACTIVITY } from "./activity-options";

const judge = proxyActivities<typeof judgeActivities>(SHORT_ACTIVITY);

export const getProgressQuery = defineQuery<RejudgeProgress>("getProgress");

export async function rejudgeWorkflow(input: RejudgeInput): Promise<void> {
  let completed = 0;
  let total = 0;
  setHandler(getProgressQuery, () => ({ completed, total }));

  let targets: { submissionId: string; draft: SubmissionDraft }[];
  if (input.mode === "single") {
    const one = await judge.fetchSingleSubmissionForRejudge(input.submissionId);
    targets = one ? [one] : [];
  } else {
    targets = await judge.fetchSubmissionIdsForRejudge(input);
  }

  total = targets.length;
  if (total === 0) return;

  const forRejudge = { triggeredByUserId: input.triggeredByUserId };

  const BATCH_SIZE = 10;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (sub) => {
        await executeChild(submissionJudgeWorkflow, {
          workflowId: `rejudge-${sub.submissionId}-${String(Date.now())}`,
          args: [{ submissionId: sub.submissionId, draft: sub.draft, forRejudge }],
        });
        completed++;
      }),
    );
  }
}
