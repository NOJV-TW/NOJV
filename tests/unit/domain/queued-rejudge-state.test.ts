import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), progress: vi.fn(), record: vi.fn() }));
vi.mock("@nojv/db", () => ({
  durableWorkRepo: { listQueuedRejudges: mocks.rows, recordRejudgeProgress: mocks.record },
}));
vi.mock("../../../packages/application/src/shared/orchestration", () => ({
  getDomainOrchestration: () => ({ queryRejudgeProgress: mocks.progress }),
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
    payload: {
      workflowId: "rejudge-batch",
      input: { mode: "batch", problemId: "problem", triggeredByUserId: "staff" },
    },
  };
}
beforeEach(() => vi.resetAllMocks());

describe("batch rejudge pending overlay", () => {
  it("hides eligible verdicts before dispatch without querying Temporal", async () => {
    mocks.rows.mockResolvedValue([{ ...row("a"), status: "pending", attempt: 0 }]);
    expect(await queuedRejudges({ userId: "user" })).toEqual(
      new Map([["a", { pending: true, updatedAt: later }]]),
    );
    expect(mocks.progress).not.toHaveBeenCalled();
  });

  it("uses captured targets and generations, including a result completed after dispatch", async () => {
    mocks.rows.mockResolvedValue([row("a"), row("completed", 2), row("not-selected")]);
    mocks.progress.mockResolvedValue({
      status: "running",
      completed: 1,
      total: 2,
      targets: [
        { submissionId: "a", judgeGeneration: 1 },
        { submissionId: "completed", judgeGeneration: 1 },
      ],
    });
    expect(await queuedRejudges({})).toEqual(
      new Map([
        ["a", { pending: true, updatedAt: later }],
        ["completed", { pending: false, updatedAt: later }],
        ["not-selected", { pending: false, updatedAt: later }],
      ]),
    );
    expect(mocks.progress).toHaveBeenCalledOnce();
  });

  it("distinguishes a capture still pending from a captured empty target set", async () => {
    mocks.rows.mockResolvedValue([row("a")]);
    mocks.progress.mockResolvedValue({
      status: "running",
      completed: 0,
      total: 0,
      targets: null,
    });
    expect((await queuedRejudges({})).get("a")?.pending).toBe(true);
    mocks.progress.mockResolvedValue({
      status: "running",
      completed: 0,
      total: 0,
      targets: [],
    });
    expect((await queuedRejudges({})).get("a")).toEqual({ pending: false, updatedAt: later });
  });

  it("restores a provisional candidate omitted by capture without rolling back its timestamp", async () => {
    mocks.rows.mockResolvedValue([
      { ...row("omitted"), submissionUpdatedAt: new Date(enqueuedAt.getTime() - 1000) },
    ]);
    mocks.progress.mockResolvedValue({
      status: "running",
      completed: 0,
      total: 0,
      targets: null,
    });
    expect((await queuedRejudges({})).get("omitted")).toEqual({
      pending: true,
      updatedAt: enqueuedAt,
    });
    mocks.progress.mockResolvedValue({
      status: "running",
      completed: 0,
      total: 0,
      targets: [],
    });
    expect((await queuedRejudges({})).get("omitted")).toEqual({
      pending: false,
      updatedAt: enqueuedAt,
    });
  });

  it.each(["completed", "failed", "cancelled"])(
    "releases retained verdicts after %s",
    async (status) => {
      mocks.rows.mockResolvedValue([row("a")]);
      mocks.progress.mockResolvedValue({ status, completed: 0, total: 1 });
      expect((await queuedRejudges({})).get("a")).toEqual({ pending: false, updatedAt: later });
      expect(mocks.record).toHaveBeenCalledOnce();
    },
  );
});
