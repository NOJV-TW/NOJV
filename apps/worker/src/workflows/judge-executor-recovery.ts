import {
  ActivityFailure,
  CancellationScope,
  TimeoutFailure,
  condition,
  defineQuery,
  defineSignal,
  log,
  setHandler,
} from "@temporalio/workflow";

export interface JudgeExecutorRecoveryIdentity {
  runId: string;
  permitId: string;
}

export interface JudgeExecutorRecovery extends JudgeExecutorRecoveryIdentity {
  activityId?: string;
  activityType?: string;
  workerIdentity?: string;
  timeoutType: string;
}

export const judgeExecutorRecovery = defineQuery<JudgeExecutorRecovery | null>(
  "judgeExecutorRecovery",
);
export const confirmJudgeExecutorStopped = defineSignal<[JudgeExecutorRecoveryIdentity]>(
  "confirmJudgeExecutorStopped",
);

export function executorTimeout(
  error: unknown,
): Omit<JudgeExecutorRecovery, "runId" | "permitId"> | null {
  const visited = new Set<Error>();
  let current = error;
  let activity: ActivityFailure | undefined;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    if (current instanceof ActivityFailure) activity = current;
    if (current instanceof TimeoutFailure && current.timeoutType !== "SCHEDULE_TO_START") {
      return {
        timeoutType: current.timeoutType ?? "UNKNOWN",
        ...(activity?.activityId ? { activityId: activity.activityId } : {}),
        ...(activity?.activityType ? { activityType: activity.activityType } : {}),
        ...(activity?.identity ? { workerIdentity: activity.identity } : {}),
      };
    }
    current = current.cause;
  }
  return null;
}

export function createJudgeExecutorRecovery() {
  let pending: JudgeExecutorRecovery | null = null;
  let confirmed = false;
  setHandler(judgeExecutorRecovery, () => pending);
  setHandler(confirmJudgeExecutorStopped, (identity) => {
    if (pending?.runId === identity.runId && pending.permitId === identity.permitId)
      confirmed = true;
  });
  return async (error: unknown, identity: JudgeExecutorRecoveryIdentity): Promise<void> => {
    const timeout = executorTimeout(error);
    if (!timeout) return;
    await CancellationScope.nonCancellable(async () => {
      pending = { ...identity, ...timeout };
      confirmed = false;
      log.error("cleanup_pending: timed-out judge executor requires verified stop", {
        ...pending,
      });
      // Resource absence cannot prove that a timed-out producer has stopped creating resources.
      await condition(() => confirmed);
      pending = null;
    });
  };
}

export type WaitForJudgeExecutorRecovery = ReturnType<typeof createJudgeExecutorRecovery>;
