import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type { SubmissionJudgeInput, SubmissionJudgeStatus } from "../types";

import type * as judgeActivities from "../activities/judge";
import type * as statsActivities from "../activities/stats";
import type * as notificationActivities from "../activities/notification";
import type * as contestActivities from "../activities/contest";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

// Judging can take a few minutes (compilation + testcases); keep a wider timeout.
const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 }
});

const stats = proxyActivities<typeof statsActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof notificationActivities>(NOTIFICATION_ACTIVITY);
const contest = proxyActivities<typeof contestActivities>(SHORT_ACTIVITY);

export const getStatusQuery = defineQuery<SubmissionJudgeStatus>("getStatus");

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  let status: SubmissionJudgeStatus = "queued";
  setHandler(getStatusQuery, () => status);

  status = "compiling";
  const judgeContext = await judge.fetchJudgeContext(input.submissionId);

  status = "running";
  const result = await judge.executeSandbox(input.submissionId, input.draft, judgeContext);

  const submission = await judge.completeSubmission(input.submissionId, result);

  if (submission.contestParticipationId) {
    await contest.updateContestScores(submission.contestParticipationId);
  }

  status = "completed";
  await Promise.all([
    stats.updateUserStats(submission),
    notification.publishVerdict(submission)
  ]);
}
