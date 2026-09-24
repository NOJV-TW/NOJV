import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  first: vi.fn(),
  many: vi.fn(),
  count: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../../../packages/db/src/client", () => ({
  prisma: { $transaction: mock.transaction },
}));
import { submissionRepo } from "../../../packages/db/src/repositories/submission";

const boundary = { id: "s100", createdAt: new Date("2026-09-21T00:00:00Z") };
beforeEach(() => {
  vi.resetAllMocks();
  mock.first.mockResolvedValue(boundary);
  mock.many.mockResolvedValue([]);
  mock.count.mockResolvedValueOnce(151).mockResolvedValueOnce(3);
  mock.transaction.mockImplementation(async (callback) =>
    callback({ submission: { findFirst: mock.first, findMany: mock.many, count: mock.count } }),
  );
});

describe("submission history database scopes", () => {
  it("applies one authorization/filter/snapshot scope to rows and total count", async () => {
    const result = await submissionRepo.listHistoryPage({
      userId: "owner",
      filters: { status: "accepted", search: "student" },
      page: 4,
      limit: 50,
      snapshot: boundary,
    });
    expect(result).toMatchObject({ totalCount: 151, newCount: 3, snapshot: boundary });
    const query = mock.many.mock.calls[0]?.[0];
    expect(query).toMatchObject({
      skip: 150,
      take: 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(mock.count.mock.calls[0]?.[0].where).toEqual(query.where);
    expect(query.where.AND[0].AND[0]).toMatchObject({
      userId: "owner",
      sampleOnly: false,
      isReferenceSolution: false,
      OR: [
        {
          user: {
            activeExamSessions: { none: { endedAt: null, exam: { pageLockEnabled: true } } },
          },
        },
        { exam: { activeSessions: { some: { userId: "owner", endedAt: null } } } },
      ],
    });
    expect(query.where.AND[0].AND[1]).toMatchObject({ status: "accepted" });
    expect(query.where.AND[1]).toEqual({
      OR: [
        { createdAt: { lt: boundary.createdAt } },
        { createdAt: boundary.createdAt, id: { lte: boundary.id } },
      ],
    });
    expect(mock.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
  });

  it("validates the anchor against access scope without requiring its mutable status still match", async () => {
    await submissionRepo.listHistoryPage({
      userId: "owner",
      filters: { status: "running" },
      page: 2,
      limit: 50,
      snapshot: boundary,
    });
    expect(mock.first.mock.calls[0]?.[0].where.AND[0]).not.toHaveProperty("status");
    expect(mock.first.mock.calls[0]?.[0].where.AND[1]).toEqual(boundary);
  });

  it("rejects an inaccessible anchor before reading rows", async () => {
    mock.first.mockResolvedValueOnce(null);
    expect(
      await submissionRepo.listHistoryPage({
        userId: "owner",
        filters: {},
        page: 2,
        limit: 50,
        snapshot: boundary,
      }),
    ).toBeNull();
    expect(mock.many).not.toHaveBeenCalled();
  });

  it("scopes teacher rows and both counts to the same exam", async () => {
    await submissionRepo.listHistoryPage({
      context: { type: "exam", id: "exam" },
      filters: { language: "python" },
      page: 1,
      limit: 50,
    });
    const query = mock.many.mock.calls[0]?.[0];
    expect(query.where.AND[0].AND[0]).toEqual({
      sampleOnly: false,
      isReferenceSolution: false,
      examId: "exam",
    });
    expect(mock.count.mock.calls[1]?.[0].where.AND[0]).toEqual(query.where.AND[0]);
  });
  it("uses queued rejudge identities in the same filter for rows and counts", async () => {
    await submissionRepo.listHistoryPage({
      userId: "owner",
      filters: { status: "queued", search: "student" },
      queuedRejudgeIds: ["previously-accepted"],
      page: 1,
      limit: 50,
    });
    const query = mock.many.mock.calls[0]?.[0];
    expect(query.where.AND[0].AND[1].AND).toEqual([
      { OR: [{ status: "queued" }, { id: { in: ["previously-accepted"] } }] },
    ]);
    expect(query.where.AND[0].AND[1].OR).toHaveLength(4);
    expect(mock.count.mock.calls[0]?.[0].where).toEqual(query.where);
  });

  it("excludes queued rejudges from their retained previous verdict filter", async () => {
    await submissionRepo.listHistoryPage({
      userId: "owner",
      filters: { status: "accepted" },
      queuedRejudgeIds: ["previously-accepted"],
      page: 1,
      limit: 50,
    });
    const query = mock.many.mock.calls[0]?.[0];
    expect(query.where.AND[0].AND[1]).toMatchObject({
      status: "accepted",
      id: { notIn: ["previously-accepted"] },
    });
    expect(mock.count.mock.calls[0]?.[0].where).toEqual(query.where);
  });
});
