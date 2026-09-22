import { isSubmissionPending } from "./types";
import { z } from "zod";

export const judgeExecutionStateSchema = z.enum([
  "queued",
  "waiting_capacity",
  "running",
  "recovering",
  "blocked",
  "finalizing",
  "completed",
  "cancelled",
]);
export type JudgeExecutionState = z.infer<typeof judgeExecutionStateSchema>;
export interface JudgeExecutionInput {
  executionId: string;
}
export const JUDGE_EXECUTION_DISPATCH_KIND = "submission.execution.dispatch";
export const JUDGE_STAGE_CASES = 20;
export function judgeRecoveryDelayMs(attempt: number): number {
  return Math.min(300_000, 5_000 * 2 ** Math.min(attempt, 6));
}

export type JudgePriorityKey = 1 | 2 | 3 | 4 | 5;
export interface JudgePriority {
  priorityKey: JudgePriorityKey;
  fairnessKey: string;
}
export function judgePriorityKey(execution: {
  queueClass: string;
  recoveryEpoch: number;
  examId: string | null;
  contestId: string | null;
}): JudgePriorityKey {
  if (execution.queueClass !== "foreground") return 5;
  if (execution.recoveryEpoch > 0) return 4;
  if (execution.examId) return 1;
  if (execution.contestId) return 2;
  return 3;
}

export const judgeExecutionViewSchema = z.object({
  state: judgeExecutionStateSchema,
  generation: z.number().int().nonnegative(),
  problemGeneration: z.number().int().nonnegative().nullable(),
  reasonCode: z
    .enum(["capacity", "cleanup_required", "original_version_unavailable", "system_failure"])
    .nullable(),
  lastProgressAt: z.iso.datetime(),
  nextRetryAt: z.iso.datetime().nullable(),
});
export type JudgeExecutionView = z.infer<typeof judgeExecutionViewSchema>;

export function isSubmissionOperationActive(operation: {
  status: string;
  execution?: JudgeExecutionView | null | undefined;
}): boolean {
  return (
    isSubmissionPending(operation.status) ||
    Boolean(
      operation.execution && !["completed", "cancelled"].includes(operation.execution.state),
    )
  );
}
