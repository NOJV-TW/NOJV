import { randomUUID } from "node:crypto";

import { durableWorkRepo } from "@nojv/db";

import { durableWorkHandlers } from "./durable-work-registry";
import { recordDurableWorkOutcome } from "./durable-work-metrics";
import {
  processDurableWorkBatch,
  type DurableWorkBatchInput,
  type DurableWorkBatchResult,
} from "./durable-work-runner";

export function runDurableWorkBatch(
  input: DurableWorkBatchInput = {},
): Promise<DurableWorkBatchResult> {
  return processDurableWorkBatch(
    {
      repository: durableWorkRepo,
      handlers: durableWorkHandlers,
      ownerFactory: randomUUID,
      recordOutcome: recordDurableWorkOutcome,
    },
    input,
  );
}
