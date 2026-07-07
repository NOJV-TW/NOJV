import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  contestFindDetailById,
  contestFindForScoreboardById,
  participationFindVirtual,
  participationFindVirtualById,
  participationCreateVirtual,
  submissionGroupByUserAndProblem,
  submissionFindForContestScoreboardByContestId,
  submissionFindForVirtualContestScoreboard,
  participationFindContestScoreboardParticipants,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  contestFindDetailById: vi.fn(),
  contestFindForScoreboardById: vi.fn(),
  participationFindVirtual: vi.fn(),
  participationFindVirtualById: vi.fn(),
  participationCreateVirtual: vi.fn(),
  submissionGroupByUserAndProblem: vi.fn(),
  submissionFindForContestScoreboardByContestId: vi.fn(),
  submissionFindForVirtualContestScoreboard: vi.fn(),
  participationFindContestScoreboardParticipants: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: {
    findById: contestFindById,
    findDetailById: contestFindDetailById,
    findForScoreboardById: contestFindForScoreboardById,
  },
  submissionRepo: {
    groupByUserAndProblem: submissionGroupByUserAndProblem,
    findForContestScoreboardByContestId: submissionFindForContestScoreboardByContestId,
    findForVirtualContestScoreboard: submissionFindForVirtualContestScoreboard,
  },
  participationRepo: {
    findVirtual: participationFindVirtual,
    findVirtualById: participationFindVirtualById,
    createVirtual: participationCreateVirtual,
    findContestScoreboardParticipants: participationFindContestScoreboardParticipants,
  },
  scoreOverrideRepo: { findAllByContext: vi.fn(() => Promise.resolve([])) },
  UnifiedParticipationVersionConflict: class extends Error {},
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
  }),
  createRateLimiterConnection: () => ({
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
  }),
  keys: {
    scoreboardCache: (contestId: string, variant: string) => `sb:${contestId}:${variant}`,
    scoreboardLock: (contestId: string, variant: string) => `sb-lock:${contestId}:${variant}`,
  },
}));

import { virtualContestDomain } from "@nojv/application";

const { startVirtualContest, getVirtualContestScoreboard, assertCanSubmitToVirtualContest } =
  virtualContestDomain;

const ACTOR = {
  userId: "u_me",
  username: "me",
  displayName: "Me",
  email: "me@test.dev",
  platformRole: "student" as const,
};

const C_START = new Date("2026-01-01T00:00:00.000Z");
const C_END = new Date("2026-01-01T03:00:00.000Z");
const AFTER_C_END = new Date("2026-01-02T00:00:00.000Z");
const BEFORE_C_END = new Date("2026-01-01T02:00:00.000Z");

function publishedContest(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ctst_1",
    title: "Winter Cup",
    visibility: "published",
    startsAt: C_START,
    endsAt: C_END,
    scoringMode: "point_sum",
    ...over,
  };
}

function contestDetail(
  problems: { id: string; ordinal: number; points: number; title: string }[],
) {
  return {
    id: "ctst_1",
    title: "Winter Cup",
    visibility: "published",
    scoringMode: "point_sum",
    problems: problems.map((p) => ({
      ordinal: p.ordinal,
      points: p.points,
      problem: { id: p.id, title: p.title },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startVirtualContest", () => {
  it("creates a virtual contest with a timer matching the original duration", async () => {
    participationFindVirtual.mockResolvedValue(null);
    contestFindById.mockResolvedValue(publishedContest());
    participationCreateVirtual.mockImplementation((data) =>
      Promise.resolve({ id: "vc_1", ...data }),
    );

    const result = await startVirtualContest(ACTOR, "ctst_1", AFTER_C_END);

    expect(participationCreateVirtual).toHaveBeenCalledTimes(1);
    const arg = participationCreateVirtual.mock.calls[0]![0] as {
      startedAt: Date;
      endsAt: Date;
    };
    expect(arg.endsAt.getTime() - arg.startedAt.getTime()).toBe(3 * 60 * 60 * 1000);
    expect(arg.startedAt).toEqual(AFTER_C_END);
    expect(result.id).toBe("vc_1");
  });

  it("is idempotent — returns the existing run without creating a new one", async () => {
    const existing = { id: "vc_existing", contestId: "ctst_1", userId: "u_me" };
    participationFindVirtual.mockResolvedValue(existing);

    const result = await startVirtualContest(ACTOR, "ctst_1", AFTER_C_END);

    expect(result).toBe(existing);
    expect(contestFindById).not.toHaveBeenCalled();
    expect(participationCreateVirtual).not.toHaveBeenCalled();
  });

  it("rejects starting a virtual contest before the original contest ends", async () => {
    participationFindVirtual.mockResolvedValue(null);
    contestFindById.mockResolvedValue(publishedContest());

    await expect(startVirtualContest(ACTOR, "ctst_1", BEFORE_C_END)).rejects.toThrow(
      /after the contest ends/i,
    );
    expect(participationCreateVirtual).not.toHaveBeenCalled();
  });

  it("rejects an unpublished or missing contest", async () => {
    participationFindVirtual.mockResolvedValue(null);
    contestFindById.mockResolvedValueOnce(publishedContest({ visibility: "draft" }));
    await expect(startVirtualContest(ACTOR, "ctst_1", AFTER_C_END)).rejects.toThrow(
      /not found/i,
    );

    participationFindVirtual.mockResolvedValue(null);
    contestFindById.mockResolvedValueOnce(null);
    await expect(startVirtualContest(ACTOR, "ctst_x", AFTER_C_END)).rejects.toThrow(
      /not found/i,
    );
  });

  it("recovers from a create race — on P2002 returns the now-existing row", async () => {
    const existing = { id: "vc_race", contestId: "ctst_1", userId: "u_me" };
    participationFindVirtual.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    contestFindById.mockResolvedValue(publishedContest());
    participationCreateVirtual.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await startVirtualContest(ACTOR, "ctst_1", AFTER_C_END);
    expect(result).toBe(existing);
  });

  it("throws a clear integrity error (not raw P2002) when the conflicting row has no window", async () => {
    participationFindVirtual.mockResolvedValue(null);
    contestFindById.mockResolvedValue(publishedContest());
    participationCreateVirtual.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(startVirtualContest(ACTOR, "ctst_1", AFTER_C_END)).rejects.toThrow(
      /missing its start\/end window/i,
    );
  });
});

describe("assertCanSubmitToVirtualContest", () => {
  it("passes for an active run when the problem belongs to the contest", async () => {
    participationFindVirtualById.mockResolvedValue({
      id: "vc_1",
      userId: "u_me",
      contestId: "ctst_1",
      endsAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    contestFindDetailById.mockResolvedValue(
      contestDetail([{ id: "p1", ordinal: 1, points: 100, title: "Alpha" }]),
    );

    const gate = await assertCanSubmitToVirtualContest(
      "vc_1",
      "u_me",
      "p1",
      new Date("2026-01-02T00:00:00.000Z"),
    );
    expect(gate).toEqual({ participationId: "vc_1", contestId: "ctst_1" });
  });

  it("rejects a submission after the personal timer has expired", async () => {
    participationFindVirtualById.mockResolvedValue({
      id: "vc_1",
      userId: "u_me",
      contestId: "ctst_1",
      endsAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await expect(
      assertCanSubmitToVirtualContest(
        "vc_1",
        "u_me",
        "p1",
        new Date("2026-01-02T00:00:01.000Z"),
      ),
    ).rejects.toThrow(/timer has ended/i);
    expect(contestFindDetailById).not.toHaveBeenCalled();
  });

  it("rejects when the run belongs to another user", async () => {
    participationFindVirtualById.mockResolvedValue({
      id: "vc_1",
      userId: "u_other",
      contestId: "ctst_1",
      endsAt: new Date("2026-01-03T00:00:00.000Z"),
    });

    await expect(
      assertCanSubmitToVirtualContest(
        "vc_1",
        "u_me",
        "p1",
        new Date("2026-01-02T00:00:00.000Z"),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a problem that is not part of the replayed contest", async () => {
    participationFindVirtualById.mockResolvedValue({
      id: "vc_1",
      userId: "u_me",
      contestId: "ctst_1",
      endsAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    contestFindDetailById.mockResolvedValue(
      contestDetail([{ id: "p1", ordinal: 1, points: 100, title: "Alpha" }]),
    );

    await expect(
      assertCanSubmitToVirtualContest(
        "vc_1",
        "u_me",
        "p_unrelated",
        new Date("2026-01-02T00:00:00.000Z"),
      ),
    ).rejects.toThrow(/not part of the contest/i);
  });
});

describe("getVirtualContestScoreboard", () => {
  it("builds the user's live row from virtual-tagged submissions and appends ghost rows", async () => {
    participationFindVirtual.mockResolvedValue({
      id: "vc_1",
      contestId: "ctst_1",
      userId: "u_me",
      startedAt: new Date("2026-02-01T00:00:00.000Z"),
      endsAt: new Date("2026-02-01T03:00:00.000Z"),
    });
    contestFindDetailById.mockResolvedValue(
      contestDetail([{ id: "p1", ordinal: 1, points: 100, title: "Alpha" }]),
    );

    contestFindForScoreboardById.mockResolvedValue({
      id: "ctst_1",
      visibility: "published",
      scoringMode: "point_sum",
      scoreboardMode: "live",
      frozenBoard: false,
      frozenAt: null,
      startsAt: C_START,
      endsAt: C_END,
      problems: [{ problemId: "p1", ordinal: 1, points: 100, problem: { title: "Alpha" } }],
    });
    participationFindContestScoreboardParticipants.mockResolvedValue([
      {
        userId: "u_ghost",
        user: { username: "ghost", displayUsername: "ghost", name: "Ghost" },
      },
    ]);
    submissionFindForContestScoreboardByContestId.mockResolvedValue([
      {
        createdAt: new Date("2026-01-01T01:00:00.000Z"),
        problemId: "p1",
        score: 100,
        status: "accepted",
        userId: "u_ghost",
      },
    ]);

    submissionFindForVirtualContestScoreboard.mockResolvedValue([
      {
        createdAt: new Date("2026-02-01T00:30:00.000Z"),
        problemId: "p1",
        score: 100,
        status: "accepted",
        userId: "u_me",
      },
    ]);

    const board = await getVirtualContestScoreboard("ctst_1", "u_me");

    expect(board).not.toBeNull();
    const rows = board!.rows;
    expect(rows).toHaveLength(2);
    const me = rows.find((r) => r.isMe);
    const ghost = rows.find((r) => r.isGhost);
    expect(me).toBeDefined();
    expect(ghost).toBeDefined();
    expect(me!.totalScore).toBe(100);
    expect(me!.isGhost).toBe(false);
    expect(ghost!.isMe).toBe(false);
  });

  it("returns null when the user has no virtual contest", async () => {
    participationFindVirtual.mockResolvedValue(null);

    const board = await getVirtualContestScoreboard("ctst_1", "u_me");
    expect(board).toBeNull();
    expect(contestFindDetailById).not.toHaveBeenCalled();
  });
});
