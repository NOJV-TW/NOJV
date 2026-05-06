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
  retry: { maximumAttempts: 3 },
});

const stats = proxyActivities<typeof statsActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof notificationActivities>(NOTIFICATION_ACTIVITY);
const contest = proxyActivities<typeof contestActivities>(SHORT_ACTIVITY);

export const getStatusQuery = defineQuery<SubmissionJudgeStatus>("getStatus");

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  let status: SubmissionJudgeStatus = "queued";
  setHandler(getStatusQuery, () => status);

  // When invoked via rejudgeWorkflow, snapshot the pre-rejudge state
  // before we overwrite it. A null return means the submission no
  // longer exists (e.g. deleted between dispatch and workflow start);
  // in that case we skip both the snapshot and the finalize and let
  // the judge proceed normally — it will fail cleanly if the row is
  // truly gone.
  let rejudgeLogId: string | null = null;
  let rejudgeOldStatus: string | null = null;
  if (input.forRejudge) {
    const snap = await judge.snapshotSubmissionForRejudge(
      input.submissionId,
      input.forRejudge.triggeredByUserId,
    );
    rejudgeLogId = snap?.logId ?? null;
    rejudgeOldStatus = snap?.oldStatus ?? null;
  }

  status = "compiling";
  const judgeContext = await judge.fetchJudgeContext(input.submissionId);

  status = "running";
  const result = await judge.executeSandbox(input.submissionId, input.draft, judgeContext);

  // Inlined: workflow sandbox can't import @nojv/domain (would pull Prisma into
  // the workflow bundle). Mirrors `submissionDomain.deriveJudgeMode` — kept in
  // sync by the unit test on `deriveJudgeMode` covering the same condition.
  const mode: "standard" | "advanced" =
    judgeContext.problemType === "special_env" && judgeContext.advanced !== null
      ? "advanced"
      : "standard";
  const submission = await judge.completeSubmission(input.submissionId, result, mode);

  if (submission.contestParticipationId) {
    await contest.updateContestScores(submission.contestParticipationId);
  }

  status = "completed";
  await Promise.all([
    rejudgeOldStatus !== null
      ? stats.adjustUserStatsForRejudge(submission, rejudgeOldStatus)
      : stats.updateUserStats(submission),
    notification.publishVerdict(submission),
  ]);

  if (rejudgeLogId) {
    await judge.finalizeRejudgeLog(
      input.submissionId,
      input.forRejudge?.triggeredByUserId ?? null,
      rejudgeLogId,
    );
  }
}
