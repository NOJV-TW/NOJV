import { proxyActivities } from "@temporalio/workflow";

import type { DurableWorkBatchResult } from "../activities/durable-work-runner";
import {
  DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS,
  DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
} from "../durable-work-config";

interface DurableWorkActivities {
  runDurableWorkBatch(): Promise<DurableWorkBatchResult>;
}

const { runDurableWorkBatch } = proxyActivities<DurableWorkActivities>({
  startToCloseTimeout: DURABLE_WORK_ACTIVITY_TIMEOUT_MS,
  retry: { maximumAttempts: DURABLE_WORK_ACTIVITY_MAX_ATTEMPTS },
});

export function durableWorkWorkflow(): Promise<DurableWorkBatchResult> {
  return runDurableWorkBatch();
}
