import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), record: vi.fn() }));
vi.mock("@nojv/db", () => ({
  durableWorkRepo: { listQueuedRejudges: mocks.rows, recordRejudgeProgress: mocks.record },
}));
import { queuedRejudges } from "../../../packages/application/src/submission/rejudge-control";

const enqueuedAt = new Date("2026-09-21T00:00:00Z");
const later = new Date("2026-09-21T00:01:00Z");
function row(id: string, generation = 1) {
  return {
    submissionId: id,
    submissionGeneration: generation,
    submissionUpdatedAt: later,
    updatedAt: enqueuedAt,
    status: "succeeded",
    attempt: 1,
    result: null as unknown,
    payload: {
      workflowId: "rejudge-batch",
      input: { mode: "batch", problemId: "problem", triggeredByUserId: "staff" },
    },
  };
}
beforeEach(() => vi.resetAllMocks());

describe("batch rejudge pending overlay", () => {
  it("hides eligible verdicts before dispatch", async () => {
    mocks.rows.mockResolvedValue([{ ...row("a"), status: "pending", attempt: 0 }]);
    expect(await queuedRejudges({ userId: "user" })).toEqual(
      new Map([["a", { pending: true, updatedAt: later }]]),
    );
  });

  it("keeps a leased dispatch pending without rolling back its timestamp", async () => {
    mocks.rows.mockResolvedValue([
      {
        ...row("leased"),
        status: "leased",
        submissionUpdatedAt: new Date(enqueuedAt.getTime() - 1000),
      },
    ]);
    expect((await queuedRejudges({})).get("leased")).toEqual({
      pending: true,
      updatedAt: enqueuedAt,
    });
  });

  it.each(["cancelled", "dead"])(
    "releases retained verdicts for a %s dispatch",
    async (status) => {
      mocks.rows.mockResolvedValue([{ ...row("a"), status }]);
      expect((await queuedRejudges({})).get("a")).toEqual({ pending: false, updatedAt: later });
    },
  );

  it.each(["completed", "failed", "cancelled"])(
    "releases retained verdicts after a cached %s result",
    async (status) => {
      mocks.rows.mockResolvedValue([
        { ...row("a"), result: { status, completed: 0, total: 1 } },
      ]);
      expect((await queuedRejudges({})).get("a")).toEqual({ pending: false, updatedAt: later });
      expect(mocks.record).not.toHaveBeenCalled();
    },
  );
});
