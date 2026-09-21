import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SubmissionJudgeInput } from "@nojv/core";
import type * as judgeActivities from "../../../../apps/worker/src/activities/judge";

const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3, nonRetryableErrorTypes: ["SandboxAdmissionError"] },
});
const sandbox = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  const runId = workflowInfo().workflowId;
  await judge.startSubmissionJudgeRun(input.submissionId, runId);
  const meta = await judge.fetchJudgeContext(input.submissionId);
  const { result, advancedJudgeVerificationSnapshot } = await sandbox.executeSandbox(
    input.submissionId,
    input.draft,
  );
  const completed = await judge.completeSubmission(
    input.submissionId,
    runId,
    result,
    meta.problemType === "special_env" ? "advanced" : "standard",
    advancedJudgeVerificationSnapshot,
  );
  if (completed !== null) throw new Error("Replay fixture requires a fenced completion");
}
