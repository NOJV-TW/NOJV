import { proxyActivities, defineQuery, setHandler } from "@temporalio/workflow";
import type { SubmissionJudgeInput, SubmissionJudgeStatus } from "@nojv/temporal";

import type * as judgeActivities from "../activities/judge";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";

// Short judge activities are DB-bound and finish quickly; they do not
// heartbeat, so they must NOT carry a `heartbeatTimeout`.
const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

// `executeSandbox` is the long-running step (compile + run every testcase in a
// sandbox subprocess). It heartbeats on a 15s interval, so a `heartbeatTimeout`
// lets Temporal detect a wedged sandbox well before the 5m `startToCloseTimeout`;
// 60s tolerates a few missed beats from GC / slow ticks before failing the attempt.
const judgeSandbox = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const stats = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);
const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);
const contest = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

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
  const result = await judgeSandbox.executeSandbox(
    input.submissionId,
    input.draft,
    judgeContext,
  );

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
