import { getTemporalClient, JUDGE_TASK_QUEUE } from "@nojv/temporal";
import type { SubmissionJudgeInput } from "@nojv/temporal";
import { submissionJudgeJobSchema } from "@nojv/core";
import type { SubmissionJudgeJob } from "@nojv/core";

export async function dispatchSubmissionJob(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const client = await getTemporalClient();

  const input: SubmissionJudgeInput = {
    submissionId: validated.submissionId,
    draft: validated.draft
  };

  await client.workflow.start("submissionJudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `judge-${validated.submissionId}`,
    args: [input]
  });
}
