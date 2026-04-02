import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type { SubmissionJudgeInput, SubmissionJudgeStatus } from "../types";

import type * as judgeActivities from "../activities/judge";
import type * as statsActivities from "../activities/stats";
import type * as notificationActivities from "../activities/notification";
import type * as contestActivities from "../activities/contest";

const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 }
});

const stats = proxyActivities<typeof statsActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 }
});

const notification = proxyActivities<typeof notificationActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 2 }
});

const contest = proxyActivities<typeof contestActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 }
});

export const getStatusQuery = defineQuery<SubmissionJudgeStatus>("getStatus");

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  let status: SubmissionJudgeStatus = "queued";
  setHandler(getStatusQuery, () => status);

  // 1. Fetch judge context
  status = "compiling";
  const judgeContext = await judge.fetchJudgeContext(input.submissionId);

  // 2. Execute sandbox
  status = "running";
  const result = await judge.executeSandbox(input.submissionId, input.draft, judgeContext);

  // 3. Complete submission (write verdict to DB)
  const submission = await judge.completeSubmission(input.submissionId, result);

  // 4. Update contest scores if applicable
  if (submission.contestParticipationId) {
    await contest.updateContestScores(submission.contestParticipationId);
  }

  // 5. Update user stats + publish verdict in parallel
  status = "completed";
  await Promise.all([
    stats.updateUserStats(submission),
    notification.publishVerdict(submission)
  ]);
}
