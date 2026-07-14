import { beforeEach, describe, expect, it, vi } from "vitest";

import { DURABLE_WORK_ITEMS_PER_EXECUTION } from "../../../apps/worker/src/durable-work-config";
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
    runDurableWorkBatch
      .mockResolvedValueOnce(succeeded("notification"))
      .mockResolvedValueOnce(succeeded("submission"))
      .mockResolvedValueOnce(succeeded("rejudge"))
      .mockResolvedValueOnce(EMPTY);

    await expect(drainDurableWork(runDurableWorkBatch, continueAsNew)).resolves.toEqual({
      claimed: 3,
      succeeded: 3,
      retried: 0,
      dead: 0,
      processedKind: "rejudge",
    });
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(1, {});
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(2, {
      afterKind: "notification",
    });
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(3, {
      afterKind: "submission",
    });
    expect(runDurableWorkBatch).toHaveBeenNthCalledWith(4, {
      afterKind: "rejudge",
    });
    expect(continueAsNew).not.toHaveBeenCalled();
  });

  it("continues as new at the deterministic item bound and preserves the fairness cursor", async () => {
    runDurableWorkBatch.mockImplementation(() => {
      const index = runDurableWorkBatch.mock.calls.length - 1;
      return Promise.resolve(succeeded(index % 2 === 0 ? "notification" : "submission"));
    });

    await expect(drainDurableWork(runDurableWorkBatch, continueAsNew)).rejects.toBe(CONTINUED);

    expect(runDurableWorkBatch).toHaveBeenCalledTimes(DURABLE_WORK_ITEMS_PER_EXECUTION);
    expect(continueAsNew).toHaveBeenCalledWith({ afterKind: "submission" });
  });
});
