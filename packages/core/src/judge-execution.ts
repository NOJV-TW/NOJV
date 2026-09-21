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
  capacity?: true;
}
export const JUDGE_EXECUTION_DISPATCH_KIND = "submission.execution.dispatch";
export const JUDGE_STAGE_CASES = 20;
export function judgeRecoveryDelayMs(attempt: number, capacity: boolean): number {
  return capacity ? 30_000 : Math.min(300_000, 5_000 * 2 ** Math.min(attempt, 6));
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
