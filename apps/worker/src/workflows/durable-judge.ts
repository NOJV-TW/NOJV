import {
  ActivityFailure,
  ApplicationFailure,
  continueAsNew,
  isCancellation,
  patched,
  proxyActivities,
  sleep,
  TimeoutFailure,
  workflowInfo,
} from "@temporalio/workflow";
import {
  judgeRecoveryDelayMs,
  type JudgeExecutionInput,
  type JudgeExecutionState,
} from "@nojv/core";
import type * as executionActivities from "../activities/judge-execution";
import type * as lifecycleActivities from "../activities/lifecycle";
import { JUDGE_CLEANUP_QUEUE, JUDGE_STATE_QUEUE, PLATFORM_QUEUE } from "./activity-options";

const journal = proxyActivities<typeof executionActivities>({
  taskQueue: JUDGE_STATE_QUEUE,
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
const SANDBOX_ACTIVITY = {
  allowEagerDispatch: false,
  startToCloseTimeout: "70m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
} as const;
const sandbox = proxyActivities<typeof executionActivities>(SANDBOX_ACTIVITY);
const cleanups = proxyActivities<typeof executionActivities>({
  taskQueue: JUDGE_CLEANUP_QUEUE,
  startToCloseTimeout: "5m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 5 },
});
const notifications = proxyActivities<typeof lifecycleActivities>({
  taskQueue: JUDGE_STATE_QUEUE,
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
const effects = proxyActivities<typeof lifecycleActivities>({
  taskQueue: PLATFORM_QUEUE,
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});

function recoveryDelayMs(capacity: boolean, blocked: boolean, failures: number): number {
  if (capacity) return 30_000;
  if (blocked) return 900_000;
  return judgeRecoveryDelayMs(failures - 1);
}

function recoveryState(
  finalizing: boolean,
  capacity: boolean,
  blocked: boolean,
): JudgeExecutionState {
  if (finalizing) return "finalizing";
  if (capacity) return "waiting_capacity";
  if (blocked) return "blocked";
  return "recovering";
}

export async function durableJudgeWorkflow(input: JudgeExecutionInput): Promise<void> {
  const { workflowId, priority } = workflowInfo();
  const stages = proxyActivities<typeof executionActivities>({
    ...SANDBOX_ACTIVITY,
    ...(priority ? { priority } : {}),
  });
  let failures = 0;
  let published = false;
  for (let iteration = 0; ; iteration++) {
    if (iteration >= 100 || workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof durableJudgeWorkflow>(input);
    let finalizing = false;
    let cleanup: Promise<void> | undefined;
    try {
      const state = await journal.judgeExecutionStatus(input.executionId, workflowId);
      finalizing = state.state === "finalizing";
      if (state.leaseToken) {
        const safe = await stages.reconcileJudgeStage(
          input.executionId,
          workflowId,
          state.leaseToken,
        );
        if (!safe) {
          await journal.setJudgeExecutionState(
            input.executionId,
            workflowId,
            "blocked",
            "cleanup_required",
            "Waiting for the previous sandbox resources to be released.",
            60_000,
          );
          await sleep("60s");
          continue;
        }
      }
      if (state.state === "cancelled" || state.state === "completed") return;
      if (!finalizing) {
        await journal.setJudgeExecutionState(input.executionId, workflowId, "queued");
        const stage = patched("deferred-stage-cleanup-v1")
          ? await stages.executeJudgeStage(input.executionId, workflowId, state.stage, true)
          : await stages.executeJudgeStage(input.executionId, workflowId, state.stage);
        if (stage.status === "obsolete") return;
        if (stage.status === "cleanup") {
          await sleep("5s");
          continue;
        }
        if ("cleanup" in stage) {
          cleanup = cleanups.cleanupJudgeStage(input.executionId, workflowId, stage.cleanup);
          cleanup.catch(() => undefined);
        }
        if (stage.status !== "finished") {
          await cleanup;
          failures = 0;
          continue;
        }
        finalizing = true;
        if (!patched("stage-commits-finalizing-v1"))
          await journal.setJudgeExecutionState(input.executionId, workflowId, "finalizing");
      }
      if (!published) {
        const submission = await journal.completePinnedJudge(input.executionId, workflowId);
        if (submission) {
          if (submission.contestId) {
            const id = await effects.updateContestScores(
              submission.contestId,
              submission.userId,
            );
            if (id) await notifications.publishScoreboardUpdate(id);
          } else if (submission.examId)
            await effects.updateExamScores(submission.examId, submission.userId);
          await effects.publishVerdict(submission);
        }
        published = cleanup !== undefined;
      }
      await cleanup;
      await journal.finishJudgeExecution(input.executionId, workflowId);
      return;
    } catch (error) {
      if (isCancellation(error)) throw error;
      await cleanup?.catch(() => undefined);
      const cause = error instanceof ActivityFailure ? error.cause : error;
      if (
        cause instanceof TimeoutFailure &&
        cause.timeoutType === "HEARTBEAT" &&
        cause.lastHeartbeatDetails === undefined &&
        patched("unstarted-stage-requeue-v1")
      )
        continue;
      const type = cause instanceof ApplicationFailure ? cause.type : "infrastructure";
      const capacity = type === "SandboxBackpressureError";
      failures++;
      const blocked =
        !capacity &&
        (type === "SandboxCleanupError" ||
          type === "SandboxAdmissionError" ||
          type === "SandboxInfeasibleError" ||
          failures >= 3);
      const delay = recoveryDelayMs(capacity, blocked, failures);
      try {
        await journal.setJudgeExecutionState(
          input.executionId,
          workflowId,
          recoveryState(finalizing, capacity, blocked),
          type ?? "infrastructure",
          cause instanceof Error ? cause.message : String(cause),
          delay,
        );
      } catch (recordError) {
        if (isCancellation(recordError)) throw recordError;
      }
      await sleep(delay);
    }
  }
}

export async function judgeCleanupWorkflow(input: {
  executionId: string;
  workflowId: string;
  leaseToken: string;
}) {
  for (let attempt = 0; ; attempt++) {
    if (attempt >= 100 || workflowInfo().continueAsNewSuggested)
      await continueAsNew<typeof judgeCleanupWorkflow>(input);
    try {
      if (
        await sandbox.reconcileJudgeStage(input.executionId, input.workflowId, input.leaseToken)
      )
        return;
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    await sleep("60s");
  }
}
