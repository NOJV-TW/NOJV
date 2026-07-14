import { continueAsNew, proxyActivities } from "@temporalio/workflow";

import type {
  DurableWorkBatchInput,
  DurableWorkBatchResult,
} from "../activities/durable-work-runner";
import {
  DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS,
  DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
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
  let afterKind = input.afterKind;

  for (let item = 0; item < DURABLE_WORK_ITEMS_PER_EXECUTION; item += 1) {
    const result = await runBatch(afterKind ? { afterKind } : {});
    total.claimed += result.claimed;
    total.succeeded += result.succeeded;
    total.retried += result.retried;
    total.dead += result.dead;

    if (result.claimed === 0) return total;
    if (!result.processedKind) {
      throw new Error("Durable work activity claimed an item without reporting its kind.");
    }
    afterKind = result.processedKind;
    total.processedKind = afterKind;
  }

  if (!afterKind) {
    throw new Error("Durable work drain reached its item bound without a fairness cursor.");
  }
  return continueRun({ afterKind });
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
