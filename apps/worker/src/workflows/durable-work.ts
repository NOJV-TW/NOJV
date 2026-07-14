import { proxyActivities } from "@temporalio/workflow";

import type { DurableWorkBatchResult } from "../activities/durable-work-runner";

interface DurableWorkActivities {
  runDurableWorkBatch(): Promise<DurableWorkBatchResult>;
}

const { runDurableWorkBatch } = proxyActivities<DurableWorkActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
  },
});

export function durableWorkWorkflow(): Promise<DurableWorkBatchResult> {
  return runDurableWorkBatch();
}
