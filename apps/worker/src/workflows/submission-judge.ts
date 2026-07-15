import { CancellationScope, proxyActivities, workflowInfo } from "@temporalio/workflow";
import type { SubmissionJudgeInput } from "@nojv/core";

import type * as judgeActivities from "../activities/judge";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, PLATFORM_QUEUE, SHORT_ACTIVITY } from "./activity-options";
import { resolveScoringDispatch } from "./submission-judge-helpers";

const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

const judgeSandbox = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);
const platformNotification = proxyActivities<typeof lifecycleActivities>({
  ...NOTIFICATION_ACTIVITY,
  taskQueue: PLATFORM_QUEUE,
});
const platformContest = proxyActivities<typeof lifecycleActivities>({
  ...SHORT_ACTIVITY,
  taskQueue: PLATFORM_QUEUE,
});

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  const judgeRunId = workflowInfo().workflowId;
  let rejudgeLogId: string | null = null;
  let rejudgeOldStatus: string | null = null;
  if (input.forRejudge) {
    const snap = await judge.snapshotSubmissionForRejudge(
      input.submissionId,
      input.forRejudge.triggeredByUserId,
      judgeRunId,
    );
    rejudgeLogId = snap?.logId ?? null;
    rejudgeOldStatus = snap?.oldStatus ?? null;
  } else {
    await judge.startSubmissionJudgeRun(input.submissionId, judgeRunId);
  }

  try {
    const meta = await judge.fetchJudgeContext(input.submissionId);

    const { result, advancedJudgeVerificationSnapshot } = await judgeSandbox.executeSandbox(
      input.submissionId,
      input.draft,
    );

    const mode: "standard" | "advanced" =
      meta.problemType === "special_env" && meta.advanced !== null ? "advanced" : "standard";
    const submission = await judge.completeSubmission(
      input.submissionId,
      judgeRunId,
      result,
      mode,
      advancedJudgeVerificationSnapshot,
    );

    if (submission === null) {
      if (rejudgeLogId) {
        await judge.finalizeRejudgeLog(
          input.submissionId,
          input.forRejudge?.triggeredByUserId ?? null,
          rejudgeLogId,
          judgeRunId,
        );
      }
      return;
    }

    const dispatch = resolveScoringDispatch(submission);
    if (dispatch.kind === "contest") {
      const contestId = await platformContest.updateContestScores(
        dispatch.contestId,
        dispatch.userId,
      );
      if (contestId) {
        await notification.publishScoreboardUpdate(contestId);
      }
    } else if (dispatch.kind === "exam") {
      await platformContest.updateExamScores(dispatch.examId, dispatch.userId);
    }

    await platformNotification.publishVerdict(submission);

    if (rejudgeLogId) {
      await judge.finalizeRejudgeLog(
        input.submissionId,
        input.forRejudge?.triggeredByUserId ?? null,
        rejudgeLogId,
        judgeRunId,
      );
    }
  } catch (err) {
    const restoreTo = rejudgeOldStatus;
    if (restoreTo !== null) {
      await CancellationScope.nonCancellable(() =>
        judge.restoreSubmissionForCancelledRejudge(input.submissionId, judgeRunId, restoreTo),
      );
    } else {
      await CancellationScope.nonCancellable(() =>
        judge.failSubmissionJudgeRun(input.submissionId, judgeRunId),
      );
    }
    throw err;
  }
}
