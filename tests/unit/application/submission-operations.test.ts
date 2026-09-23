import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executions: vi.fn(),
  read: vi.fn(),
  detail: vi.fn(),
  queued: vi.fn(),
  find: vi.fn(),
  pending: vi.fn(),
  readIds: vi.fn(),
  candidateIds: vi.fn(),
  permission: vi.fn(),
  problem: vi.fn(),
}));
vi.mock("../../../packages/application/src/submission/judge-execution", () => ({
  getJudgeExecutionViews: mocks.executions,
}));
vi.mock("@nojv/db", () => ({
  submissionRepo: {
    findById: mocks.find,
    listPendingForUser: mocks.pending,
    listByIdsForUserRead: mocks.readIds,
    listByIdsForStaffRead: mocks.candidateIds,
  },
  problemRepo: { findById: mocks.problem },
}));
vi.mock("../../../packages/application/src/submission/queries", () => ({
  getSubmissionForActor: mocks.read,
  readVerdictDetail: mocks.detail,
}));
vi.mock("../../../packages/application/src/submission/rejudge-control", () => ({
  queuedRejudges: mocks.queued,
}));
vi.mock("../../../packages/application/src/submission/permissions", () => ({
  canOperateOnSubmission: mocks.permission,
}));

import {
  getSubmissionOperation,
  listPendingSubmissionOperations,
  listSubmissionOperations,
} from "../../../packages/application/src/submission/operations";
import { NotFoundError } from "../../../packages/application/src/shared/errors";

const actor = {
  userId: "user",
  username: "user",
  email: "user@example.test",
  displayName: "User",
  platformRole: "student" as const,
};
const time = new Date("2026-09-21T00:00:00Z");
const row = {
  id: "s1",
  userId: "user",
  problemId: "p1",
  problem: { title: "Problem A" },
  status: "accepted",
  judgeGeneration: 1,
  updatedAt: time,
  score: 100,
  runtimeMs: 10,
  memoryKb: 12,
  verdictSummary: null,
  verdictDetailStorage: { key: "old" },
  sampleOnly: false,
  isReferenceSolution: false,
};
const accepted = {
  verdict: "accepted",
  accepted: true,
  score: 100,
  runtimeMs: 10,
  feedback: "Accepted.",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.queued.mockResolvedValue(new Map());
  mocks.executions.mockResolvedValue(new Map());
  mocks.read.mockResolvedValue(row);
  mocks.problem.mockResolvedValue({ title: "Problem A" });
  mocks.detail.mockResolvedValue(accepted);
  mocks.find.mockResolvedValue(null);
  mocks.readIds.mockResolvedValue([row]);
  mocks.candidateIds.mockResolvedValue([]);
});

describe("authoritative submission operations", () => {
  it("hides retained results during a running rejudge", async () => {
    mocks.read.mockResolvedValue({ ...row, status: "running", judgeGeneration: 2 });
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      status: "running",
      judgeGeneration: 2,
      result: null,
    });
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("hides an old verdict while single rejudge dispatch is queued", async () => {
    const queuedAt = new Date(time.getTime() + 1000);
    mocks.queued.mockResolvedValue(new Map([[row.id, { pending: true, updatedAt: queuedAt }]]));
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      status: "queued",
      result: null,
      updatedAt: queuedAt.toISOString(),
    });
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("returns a terminal error summary when no result object exists", async () => {
    mocks.read.mockResolvedValue({
      ...row,
      status: "system_error",
      verdictDetailStorage: null,
    });
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      status: "system_error",
      result: { verdict: "system_error", score: 0, accepted: false },
    });
  });

  it("does not return previous accepted detail retained after a failed rejudge", async () => {
    mocks.read.mockResolvedValue({ ...row, status: "system_error" });
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      result: { verdict: "system_error", score: 0 },
    });
  });

  it("rechecks generation after reading detail to reject a result from a superseded run", async () => {
    mocks.read.mockResolvedValueOnce(row).mockResolvedValueOnce({
      ...row,
      status: "running",
      judgeGeneration: 2,
      updatedAt: new Date(time.getTime() + 1000),
    });
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      status: "running",
      judgeGeneration: 2,
      result: null,
    });
  });

  it("keeps unavailable and unauthorized IDs indistinguishable", async () => {
    mocks.read.mockImplementation(async (_actor, id) => {
      if (id === "s1") return row;
      throw new NotFoundError();
    });
    mocks.find.mockImplementation(async (id) =>
      id === "private" ? { ...row, id, userId: "other" } : null,
    );
    mocks.candidateIds.mockResolvedValue([{ ...row, id: "private", userId: "other" }]);
    mocks.permission.mockResolvedValue(false);
    const result = await listSubmissionOperations(actor, ["s1", "private", "missing"]);
    expect(result.items.map((item) => item.submissionId)).toEqual(["s1"]);
    expect(result.unavailableIds).toEqual(["private", "missing"]);
  });

  it("does not load object storage for batched summaries", async () => {
    const result = await listSubmissionOperations(actor, ["s1", "s1"]);
    expect(result.items).toHaveLength(1);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("recovers own pending entries and a stable next cursor even for an admin", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...row, id: `s${index}` }));
    mocks.pending.mockResolvedValue(rows);
    mocks.read.mockImplementation(async (_actor, id) => ({ ...row, id, status: "queued" }));
    const result = await listPendingSubmissionOperations({ ...actor, platformRole: "admin" });
    expect(mocks.pending).toHaveBeenCalledWith({ userId: actor.userId, queuedIds: [] });
    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe("s49");
    expect(mocks.readIds).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.problem).not.toHaveBeenCalled();
  });

  it("accepts an empty pending list", async () => {
    mocks.pending.mockResolvedValue([]);
    expect(await listPendingSubmissionOperations(actor)).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects batches exceeding 100 IDs", async () => {
    await expect(
      listSubmissionOperations(
        actor,
        Array.from({ length: 101 }, (_, index) => String(index)),
      ),
    ).rejects.toThrow("100");
  });
  it("reads a 100-submission own batch with one scoped submission query and no per-row reads", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...row, id: `s${index}` }));
    mocks.readIds.mockResolvedValue(rows);
    const result = await listSubmissionOperations(
      actor,
      rows.map((item) => item.id),
    );
    expect(result.items).toHaveLength(100);
    expect(mocks.readIds).toHaveBeenCalledOnce();
    expect(mocks.readIds).toHaveBeenCalledWith({
      ids: rows.map((item) => item.id),
      userId: actor.userId,
      adminRecovery: false,
    });
    expect(mocks.candidateIds).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.problem).not.toHaveBeenCalled();
    expect(mocks.queued).toHaveBeenCalledOnce();
  });

  it("checks staff permission once for multiple submissions in the same exam", async () => {
    mocks.readIds.mockResolvedValue([]);
    mocks.candidateIds.mockResolvedValue(
      ["a", "b"].map((id) => ({ ...row, id, userId: "student", examId: "exam" })),
    );
    mocks.permission.mockResolvedValue(true);
    expect((await listSubmissionOperations(actor, ["a", "b"])).items).toHaveLength(2);
    expect(mocks.permission).toHaveBeenCalledOnce();
    expect(mocks.candidateIds).toHaveBeenCalledWith(["a", "b"]);
  });

  it("does not let staff fallback bypass an owner's exam confinement", async () => {
    mocks.readIds.mockResolvedValue([]);
    mocks.candidateIds.mockResolvedValue([row]);
    mocks.permission.mockResolvedValue(true);
    expect(await listSubmissionOperations(actor, [row.id])).toEqual({
      items: [],
      unavailableIds: [row.id],
    });
    expect(mocks.permission).not.toHaveBeenCalled();
  });

  it("rechecks reference access even when a submitter owns the reference", async () => {
    const reference = { ...row, isReferenceSolution: true };
    mocks.readIds.mockResolvedValue([reference]);
    mocks.candidateIds.mockResolvedValue([reference]);
    mocks.read.mockRejectedValue(new NotFoundError());
    expect(await listSubmissionOperations(actor, [row.id])).toEqual({
      items: [],
      unavailableIds: [row.id],
    });
  });
});

it.each(["system_error", "accepted"])(
  "returns active execution alongside retained %s status",
  async (status) => {
    mocks.read.mockResolvedValue({ ...row, status });
    const execution = {
      state: "recovering",
      generation: 1,
      problemGeneration: 4,
      reasonCode: "system_failure",
      lastProgressAt: time.toISOString(),
      nextRetryAt: time.toISOString(),
    };
    mocks.executions.mockResolvedValue(new Map([[row.id, execution]]));
    expect(await getSubmissionOperation(actor, row.id, true)).toMatchObject({
      status,
      execution,
    });
  },
);
