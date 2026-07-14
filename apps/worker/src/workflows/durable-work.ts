import { continueAsNew, proxyActivities } from "@temporalio/workflow";

import type {
  DurableWorkBatchInput,
  DurableWorkBatchResult,
} from "../activities/durable-work-runner";
import {
  DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS,
  DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
  DURABLE_WORK_CONCURRENCY,
  DURABLE_WORK_ITEMS_PER_EXECUTION,
} from "../durable-work-config";

interface DurableWorkActivities {
  runDurableWorkBatch(input: DurableWorkBatchInput): Promise<DurableWorkBatchResult>;
}

export type DurableWorkWorkflowInput = DurableWorkBatchInput;
type RunDurableWorkBatch = DurableWorkActivities["runDurableWorkBatch"];
type ContinueDurableWork = (input: DurableWorkWorkflowInput) => Promise<never>;

const { runDurableWorkBatch } = proxyActivities<DurableWorkActivities>({
  startToCloseTimeout: DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
  retry: { maximumAttempts: DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS },
});

export async function drainDurableWork(
  runBatch: RunDurableWorkBatch,
  continueRun: ContinueDurableWork,
  input: DurableWorkWorkflowInput = {},
): Promise<DurableWorkBatchResult> {
  const total: DurableWorkBatchResult = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    processedKind: null,
  };
  const initialOffset = input.fairnessOffset ?? 0;
  if (!Number.isSafeInteger(initialOffset) || initialOffset < 0) {
    throw new TypeError("Durable work fairness offset must be a non-negative safe integer.");
  }

  let launched = 0;
  while (launched < DURABLE_WORK_ITEMS_PER_EXECUTION) {
    const waveSize = Math.min(
      DURABLE_WORK_CONCURRENCY,
      DURABLE_WORK_ITEMS_PER_EXECUTION - launched,
    );
    const results = await Promise.all(
      Array.from({ length: waveSize }, (_, index) =>
        runBatch({ fairnessOffset: initialOffset + launched + index }),
      ),
    );
    launched += waveSize;

    for (const result of results) {
      total.claimed += result.claimed;
      total.succeeded += result.succeeded;
      total.retried += result.retried;
      total.dead += result.dead;
      if (result.claimed > 0) {
        if (!result.processedKind) {
          throw new Error("Durable work activity claimed an item without reporting its kind.");
        }
        total.processedKind = result.processedKind;
      }
    }
    if (results.some(({ claimed }) => claimed === 0)) return total;
  }

  return continueRun({ fairnessOffset: initialOffset + launched });
}

export function durableWorkWorkflow(
  input: DurableWorkWorkflowInput = {},
): Promise<DurableWorkBatchResult> {
  return drainDurableWork(
    runDurableWorkBatch,
    (nextInput) => continueAsNew<typeof durableWorkWorkflow>(nextInput),
    input,
  );
}
