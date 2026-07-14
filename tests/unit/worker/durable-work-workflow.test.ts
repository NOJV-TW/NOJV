import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DURABLE_WORK_CONCURRENCY,
  DURABLE_WORK_ITEMS_PER_EXECUTION,
} from "../../../apps/worker/src/durable-work-config";
import { drainDurableWork } from "../../../apps/worker/src/workflows/durable-work";

const CONTINUED = new Error("continued as new");
const runDurableWorkBatch = vi.fn();
const continueAsNew = vi.fn();

function succeeded(processedKind: string) {
  return { claimed: 1, succeeded: 1, retried: 0, dead: 0, processedKind };
}

const EMPTY = {
  claimed: 0,
  succeeded: 0,
  retried: 0,
  dead: 0,
  processedKind: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  continueAsNew.mockRejectedValue(CONTINUED);
});

describe("durable work workflow", () => {
  it("drains more than one queued item in a scheduled execution", async () => {
    runDurableWorkBatch.mockImplementation(({ fairnessOffset }: { fairnessOffset: number }) =>
      Promise.resolve(
        fairnessOffset < 3
          ? succeeded(["notification", "submission", "rejudge"][fairnessOffset]!)
          : EMPTY,
      ),
    );

    await expect(drainDurableWork(runDurableWorkBatch, continueAsNew)).resolves.toEqual({
      claimed: 3,
      succeeded: 3,
      retried: 0,
      dead: 0,
      processedKind: "rejudge",
    });
    expect(runDurableWorkBatch).toHaveBeenCalledTimes(DURABLE_WORK_CONCURRENCY);
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(1, { fairnessOffset: 0 });
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(DURABLE_WORK_CONCURRENCY, {
      fairnessOffset: DURABLE_WORK_CONCURRENCY - 1,
    });
    expect(continueAsNew).not.toHaveBeenCalled();
  });

  it("keeps multiple independent one-item activities in flight up to the configured bound", async () => {
    let active = 0;
    let peak = 0;
    runDurableWorkBatch.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return EMPTY;
    });

    await drainDurableWork(runDurableWorkBatch, continueAsNew);

    expect(peak).toBe(DURABLE_WORK_CONCURRENCY);
  });

  it("continues as new at the deterministic item bound and preserves the fairness cursor", async () => {
    runDurableWorkBatch.mockImplementation(({ fairnessOffset }: { fairnessOffset: number }) =>
      Promise.resolve(succeeded(fairnessOffset % 2 === 0 ? "notification" : "submission")),
    );

    await expect(drainDurableWork(runDurableWorkBatch, continueAsNew)).rejects.toBe(CONTINUED);

    expect(runDurableWorkBatch).toHaveBeenCalledTimes(DURABLE_WORK_ITEMS_PER_EXECUTION);
    expect(continueAsNew).toHaveBeenCalledWith({
      fairnessOffset: DURABLE_WORK_ITEMS_PER_EXECUTION,
    });
  });
});
