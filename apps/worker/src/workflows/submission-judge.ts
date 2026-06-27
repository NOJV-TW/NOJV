import {
  CancellationScope,
  isCancellation,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";
import type { SubmissionJudgeInput } from "@nojv/core";

import type * as judgeActivities from "../activities/judge";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, SHORT_ACTIVITY } from "./activity-options";
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
const contest = proxyActivities<typeof lifecycleActivities>(SHORT_ACTIVITY);

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  let rejudgeLogId: string | null = null;
  let rejudgeOldStatus: string | null = null;
  if (input.forRejudge) {
    const snap = await judge.snapshotSubmissionForRejudge(
      input.submissionId,
      input.forRejudge.triggeredByUserId,
      workflowInfo().workflowId,
    );
    rejudgeLogId = snap?.logId ?? null;
    rejudgeOldStatus = snap?.oldStatus ?? null;
  }

  try {
    const judgeContext = await judge.fetchJudgeContext(input.submissionId);

    const result = await judgeSandbox.executeSandbox(
      input.submissionId,
      input.draft,
      judgeContext,
    );

    const mode: "standard" | "advanced" =
      judgeContext.problemType === "special_env" && judgeContext.advanced !== null
        ? "advanced"
        : "standard";
    const submission = await judge.completeSubmission(
      input.submissionId,
      result,
      mode,
      judgeContext.advanced?.config ?? null,
    );

    const dispatch = resolveScoringDispatch(submission);
    if (dispatch.kind === "contest") {
      const contestId = await contest.updateContestScores(dispatch.contestId, dispatch.userId);
      if (contestId) {
        await notification.publishScoreboardUpdate(contestId);
      }
    } else if (dispatch.kind === "exam") {
      await contest.updateExamScores(dispatch.examId, dispatch.userId);
    }

    await notification.publishVerdict(submission);

    if (rejudgeLogId) {
      await judge.finalizeRejudgeLog(
        input.submissionId,
        input.forRejudge?.triggeredByUserId ?? null,
        rejudgeLogId,
      );
    }
  } catch (err) {
    const restoreTo = rejudgeOldStatus;
    if (restoreTo !== null && isCancellation(err)) {
      await CancellationScope.nonCancellable(() =>
        judge.restoreSubmissionForCancelledRejudge(input.submissionId, restoreTo),
      );
    }
    throw err;
  }
}
