import {
  ActivityFailure,
  CancellationScope,
  getExternalWorkflowHandle,
  makeContinueAsNewFunc,
  ApplicationFailure,
  continueAsNew,
  condition,
  defineSignal,
  setHandler,
  isCancellation,
  proxyActivities,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import { judgeRecoveryDelayMs, type JudgeExecutionInput } from "@nojv/core";
import type * as executionActivities from "../activities/judge-execution";
import type * as lifecycleActivities from "../activities/lifecycle";
import {
  executePinnedCapacity,
  JudgeRollbackRedirect,
  recoverPinnedCapacityLease,
  recoverCapacityRuns,
  recoverOrphanCapacityRun,
  type CapacityWorkflowState,
} from "./durable-capacity";
import { JUDGE_ADMISSION_ID, finishJudgeRun, finishJudgeReservation } from "./judge-admission";
import type * as capacityActivities from "../activities/judge-stages";
import { PLATFORM_QUEUE } from "./activity-options";

const journal = proxyActivities<typeof executionActivities>({
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
const sandbox = proxyActivities<typeof executionActivities>({
  startToCloseTimeout: "70m",
  heartbeatTimeout: "60s",
  retry: { maximumAttempts: 1 },
});
const notifications = proxyActivities<typeof lifecycleActivities>({
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});
const effects = proxyActivities<typeof lifecycleActivities>({
  taskQueue: PLATFORM_QUEUE,
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 3 },
});

const capacityCleanup = proxyActivities<typeof capacityActivities>({
  taskQueue: "judge-control",
  startToCloseTimeout: "2m",
  retry: { initialInterval: "5s", maximumInterval: "1m" },
});

export async function durableJudgeWorkflow(
  input: JudgeExecutionInput,
  capacityState: CapacityWorkflowState = {},
): Promise<void> {
  let continuing = false;
  try {
    await runDurableJudge(input, capacityState, () => {
      continuing = true;
    });
  } catch (error) {
    if (!(error instanceof JudgeRollbackRedirect)) throw error;
    await capacityCleanup.relinquishPinnedCapacityStrategy(
      input.executionId,
      workflowInfo().workflowId,
    );
    if (capacityState.runId)
      await getExternalWorkflowHandle(JUDGE_ADMISSION_ID).signal(
        finishJudgeRun,
        capacityState.runId,
      );
    await getExternalWorkflowHandle(JUDGE_ADMISSION_ID).signal(
      finishJudgeReservation,
      workflowInfo().workflowId,
    );
    continuing = true;
    await makeContinueAsNewFunc<typeof durableJudgeWorkflow>({ taskQueue: "judge" })({
      executionId: input.executionId,
    });
  } finally {
    if (input.capacity && !continuing)
      await CancellationScope.nonCancellable(async () => {
        const coordinator = getExternalWorkflowHandle(JUDGE_ADMISSION_ID);
        if (capacityState.runId) await coordinator.signal(finishJudgeRun, capacityState.runId);
        await coordinator.signal(finishJudgeReservation, workflowInfo().workflowId);
      });
  }
}

async function runDurableJudge(
  input: JudgeExecutionInput,
  capacityState: CapacityWorkflowState,
  markContinuing: () => void,
): Promise<void> {
  const workflowId = workflowInfo().workflowId;
  let capacityAvailable = false;
  setHandler(defineSignal("capacityAvailable"), () => {
    capacityAvailable = true;
  });
  let failures = 0;
  for (let iteration = 0; ; iteration++) {
    if (iteration >= 100 || workflowInfo().continueAsNewSuggested) {
      markContinuing();
      if (input.capacity)
        await continueAsNew<typeof durableJudgeWorkflow>(input, capacityState);
      else await continueAsNew<typeof durableJudgeWorkflow>(input);
    }
    let finalizing = false;
    try {
      const state = await journal.judgeExecutionStatus(input.executionId, workflowId);
      finalizing = state.state === "finalizing";
      if (state.leaseToken && !input.capacity) {
        const safe = await sandbox.reconcileJudgeStage(
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
      if (input.capacity) await recoverCapacityRuns(input, capacityState, state.leaseToken);
      if (state.state === "cancelled" || state.state === "completed") return;
      if (!finalizing) {
        capacityAvailable = false;
        await journal.setJudgeExecutionState(input.executionId, workflowId, "queued");
        const stage = input.capacity
          ? { status: await executePinnedCapacity(input, capacityState) }
          : await sandbox.executeJudgeStage(input.executionId, workflowId, state.stage);
        if (stage.status === "obsolete") return;
        if (stage.status === "wait" || stage.status === "cleanup") {
          await journal.setJudgeExecutionState(
            input.executionId,
            workflowId,
            "waiting_capacity",
            "capacity",
          );
          await condition(() => capacityAvailable, "5s");
          continue;
        }
        if (stage.status !== "finished") {
          failures = 0;
          continue;
        }
        finalizing = true;
        await journal.setJudgeExecutionState(input.executionId, workflowId, "finalizing");
      }
      const submission = await journal.completePinnedJudge(input.executionId, workflowId);
      if (submission) {
        if (submission.contestId) {
          const id = await effects.updateContestScores(submission.contestId, submission.userId);
          if (id) await notifications.publishScoreboardUpdate(id);
        } else if (submission.examId)
          await effects.updateExamScores(submission.examId, submission.userId);
        await effects.publishVerdict(submission);
      }
      await journal.finishJudgeExecution(input.executionId, workflowId);
      return;
    } catch (error) {
      if (isCancellation(error) || error instanceof JudgeRollbackRedirect) throw error;
      const cause = error instanceof ActivityFailure ? error.cause : error;
      const type = cause instanceof ApplicationFailure ? cause.type : "infrastructure";
      const capacity = type === "SandboxBackpressureError";
      failures++;
      const blocked =
        !capacity &&
        (type === "SandboxCleanupError" ||
          type === "SandboxAdmissionError" ||
          type === "SandboxInfeasibleError" ||
          failures >= 3);
      const delay = blocked ? 900_000 : judgeRecoveryDelayMs(failures - 1, capacity);
      try {
        await journal.setJudgeExecutionState(
          input.executionId,
          workflowId,
          finalizing
            ? "finalizing"
            : capacity
              ? "waiting_capacity"
              : blocked
                ? "blocked"
                : "recovering",
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
  capacity?: true;
}) {
  if (input.capacity) {
    const state = await journal.judgeExecutionStatus(input.executionId, input.workflowId);
    if (state.leaseToken === input.leaseToken)
      await recoverPinnedCapacityLease(input.executionId, input.workflowId, input.leaseToken);
    else await recoverOrphanCapacityRun(input);
    return;
  }
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
