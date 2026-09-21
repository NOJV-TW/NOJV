import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  getExternalWorkflowHandle,
  patched,
  makeContinueAsNewFunc,
  proxyActivities,
  workflowInfo,
  uuid4,
  sleep,
} from "@temporalio/workflow";
import type { SubmissionJudgeInput } from "@nojv/core";
import {
  executeCapacityAttempt,
  JudgeRollbackRedirect,
  type JudgeSubmissionOrder,
} from "./judge-stages";

import type * as judgeActivities from "../activities/judge";
import type * as lifecycleActivities from "../activities/lifecycle";
import { NOTIFICATION_ACTIVITY, PLATFORM_QUEUE, SHORT_ACTIVITY } from "./activity-options";
import { resolveScoringDispatch } from "./submission-judge-helpers";
import { createJudgeExecutorRecovery } from "./judge-executor-recovery";
import { finishJudgeRun, JUDGE_ADMISSION_ID } from "./judge-admission";

const judge = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3, nonRetryableErrorTypes: ["SandboxAdmissionError"] },
});

const judgeSandbox = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { maximumAttempts: 1 },
});

const legacyJudgeSandbox = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const cleanup = proxyActivities<typeof judgeActivities>({
  startToCloseTimeout: "2m",
  retry: { initialInterval: "5s", maximumInterval: "1m" },
});

async function executeAttempt(
  input: SubmissionJudgeInput,
  staged: boolean,
  order: JudgeSubmissionOrder,
) {
  if (!patched("judge-capacity-cleanup-v1"))
    return legacyJudgeSandbox.executeSandbox(input.submissionId, input.draft);
  const waitForExecutorRecovery = createJudgeExecutorRecovery();
  const runIds: string[] = [];
  try {
    for (let attempt = 0; ; attempt++) {
      const runId = uuid4();
      const replacesRunId = runIds.at(-1);
      runIds.push(runId);
      try {
        return staged
          ? await executeCapacityAttempt(
              input,
              runId,
              order,
              waitForExecutorRecovery,
              replacesRunId,
            )
          : await judgeSandbox.executeSandbox(input.submissionId, input.draft, runId);
      } catch (error) {
        if (!staged)
          await waitForExecutorRecovery(error, { runId, permitId: `${runId}/sandbox` });
        if (
          error instanceof JudgeRollbackRedirect ||
          CancellationScope.current().consideredCancelled ||
          attempt >= 2 ||
          isNonRetryableJudgeFailure(error)
        )
          throw error;
        await sleep("1s");
      } finally {
        if (!staged)
          await CancellationScope.nonCancellable(() => cleanup.cleanupSandboxRun(runId));
      }
    }
  } finally {
    if (staged)
      await CancellationScope.nonCancellable(async () => {
        const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
        for (const runId of runIds) await coordinator.signal(finishJudgeRun, runId);
      });
  }
}

export function isNonRetryableJudgeFailure(error: unknown): boolean {
  const visited = new Set<Error>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (
      current.name === "SandboxAdmissionError" ||
      current.message === "resource_request_unsatisfiable" ||
      (current instanceof ApplicationFailure &&
        (current.nonRetryable === true || current.type === "SandboxAdmissionError"))
    )
      return true;
    current = current.cause;
  }
  return false;
}

const notification = proxyActivities<typeof lifecycleActivities>(NOTIFICATION_ACTIVITY);
const platformNotification = proxyActivities<typeof lifecycleActivities>({
  ...NOTIFICATION_ACTIVITY,
  taskQueue: PLATFORM_QUEUE,
});
const platformContest = proxyActivities<typeof lifecycleActivities>({
  ...SHORT_ACTIVITY,
  taskQueue: PLATFORM_QUEUE,
});

function rootErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current.message) message = current.message;
    current = current.cause;
  }
  return message;
}

export async function submissionJudgeWorkflow(input: SubmissionJudgeInput): Promise<void> {
  try {
    await runSubmissionJudge(input);
  } catch (error) {
    if (!(error instanceof JudgeRollbackRedirect)) throw error;
    await makeContinueAsNewFunc<typeof submissionJudgeWorkflow>({ taskQueue: "judge" })(input);
  }
}

async function runSubmissionJudge(input: SubmissionJudgeInput): Promise<void> {
  const judgeRunId = workflowInfo().workflowId;
  let rejudgeLogId: string | null = null;
  let rejudgeOldStatus: string | null = null;
  if (input.forRejudge) {
    const snap = await judge.snapshotSubmissionForRejudge(
      input.submissionId,
      input.forRejudge.triggeredByUserId,
      judgeRunId,
      input.forRejudge.expectedJudgeGeneration ?? null,
    );
    if (snap === null) return;
    rejudgeLogId = snap.logId;
    rejudgeOldStatus = snap.oldStatus;
  } else {
    await judge.startSubmissionJudgeRun(input.submissionId, judgeRunId);
  }

  try {
    const meta = await judge.fetchJudgeContext(input.submissionId);

    const { result, advancedJudgeVerificationSnapshot } = await executeAttempt(
      input,
      meta.staged,
      { studentId: meta.userId, submittedAt: new Date(meta.createdAt).getTime() },
    );

    const mode: "standard" | "advanced" =
      meta.problemType === "special_env" ? "advanced" : "standard";
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
    if (err instanceof JudgeRollbackRedirect) throw err;
    const restoreTo = rejudgeOldStatus;
    if (restoreTo !== null) {
      await CancellationScope.nonCancellable(() =>
        judge.restoreSubmissionForCancelledRejudge(input.submissionId, judgeRunId, restoreTo),
      );
    } else {
      await CancellationScope.nonCancellable(() =>
        judge.failSubmissionJudgeRun(
          input.submissionId,
          judgeRunId,
          `Judge pipeline failed: ${rootErrorMessage(err)}`,
        ),
      );
    }
    throw err;
  }
}
