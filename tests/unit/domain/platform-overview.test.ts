import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countAll,
  countPublic,
  findForPlatformStats,
  findPublicMiniByIds,
  redisGet,
  redisSet,
  redisDel,
} = vi.hoisted(() => ({
  countAll: vi.fn(),
  countPublic: vi.fn(),
  findForPlatformStats: vi.fn(),
  findPublicMiniByIds: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock("@nojv/redis", () => ({
  getRedis: () => ({ get: redisGet, set: redisSet, del: redisDel }),
  keys: {
    platformOverview: () => "nojv:cache:platform-overview",
    platformOverviewLock: () => "nojv:cache:platform-overview-lock",
  },
}));

vi.mock("@nojv/db", () => ({
  userRepo: { countAll },
  problemRepo: { countPublic, findPublicMiniByIds },
  submissionRepo: { findForPlatformStats },
}));

import { getPlatformOverview } from "../../../packages/application/src/platform";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  countAll.mockReset().mockResolvedValue(0);
  countPublic.mockReset().mockResolvedValue(0);
  findForPlatformStats.mockReset().mockResolvedValue([]);
  findPublicMiniByIds.mockReset().mockResolvedValue([]);
  redisGet.mockReset().mockResolvedValue(null);
  redisSet.mockReset().mockResolvedValue("OK");
  redisDel.mockReset().mockResolvedValue(1);
});

describe("getPlatformOverview — empty server", () => {
  it("returns zeroed totals, 30 zero-filled daily buckets, and empty breakdowns", async () => {
    const overview = await getPlatformOverview();

    expect(overview.totals).toEqual({
      users: 0,
      publicProblems: 0,
      submissions30d: 0,
      acRate30d: 0,
    });
    expect(overview.daily).toHaveLength(30);
    overview.daily.forEach((d) => {
      expect(d.total).toBe(0);
      expect(d.accepted).toBe(0);
      expect(d.activeUsers).toBe(0);
      expect(d.label).toBe(d.day.slice(5));
    });
    expect(overview.byVerdict).toEqual([]);
    expect(overview.byLanguage).toEqual([]);
    expect(overview.hotProblems).toEqual([]);
    expect(findPublicMiniByIds).not.toHaveBeenCalled();
  });

  it("orders daily buckets oldest-first ending today (UTC)", async () => {
    const overview = await getPlatformOverview();

    const days = overview.daily.map((d) => d.day);
    expect(days).toEqual([...days].sort());
    expect(days.at(-1)).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("getPlatformOverview — aggregation", () => {
  it("buckets submissions per UTC day with distinct active users and accepted counts", async () => {
    findForPlatformStats.mockResolvedValue([
      {
        createdAt: daysAgo(0),
        status: "accepted",
        userId: "u1",
        language: "cpp",
        problemId: "p1",
      },
      {
        createdAt: daysAgo(0),
        status: "wrong_answer",
        userId: "u1",
        language: "cpp",
        problemId: "p1",
      },
      {
        createdAt: daysAgo(0),
        status: "accepted",
        userId: "u2",
        language: "python",
        problemId: "p1",
      },
      {
        createdAt: daysAgo(1),
        status: "time_limit_exceeded",
        userId: "u3",
        language: "cpp",
        problemId: "p2",
      },
    ]);
    findPublicMiniByIds.mockResolvedValue([
      { id: "p1", displayId: 1, title: "A" },
      { id: "p2", displayId: 2, title: "B" },
    ]);

    const overview = await getPlatformOverview();

    const today = overview.daily.at(-1);
    const yesterday = overview.daily.at(-2);
    expect(today).toMatchObject({ total: 3, accepted: 2, activeUsers: 2 });
    expect(yesterday).toMatchObject({ total: 1, accepted: 0, activeUsers: 1 });
  });

  it("computes verdict/language breakdowns sorted by count and a rounded AC rate", async () => {
    countAll.mockResolvedValue(42);
    countPublic.mockResolvedValue(7);
    findForPlatformStats.mockResolvedValue([
      {
        createdAt: daysAgo(0),
        status: "accepted",
        userId: "u1",
        language: "cpp",
        problemId: "p1",
      },
      {
        createdAt: daysAgo(0),
        status: "wrong_answer",
        userId: "u1",
        language: "cpp",
        problemId: "p1",
      },
      {
        createdAt: daysAgo(0),
        status: "wrong_answer",
        userId: "u2",
        language: "python",
        problemId: "p1",
      },
    ]);
    findPublicMiniByIds.mockResolvedValue([{ id: "p1", displayId: 1, title: "A" }]);

    const overview = await getPlatformOverview();

    expect(overview.totals).toEqual({
      users: 42,
      publicProblems: 7,
      submissions30d: 3,
      acRate30d: 33,
    });
    expect(overview.byVerdict).toEqual([
      { status: "wrong_answer", count: 2 },
      { status: "accepted", count: 1 },
    ]);
    expect(overview.byLanguage).toEqual([
      { language: "cpp", count: 2 },
      { language: "python", count: 1 },
    ]);
  });

  it("lists only public problems as hot problems, sorted by attempts and capped at 8", async () => {
    const rows = [];
    for (let p = 0; p < 10; p++) {
      for (let i = 0; i <= p; i++) {
        rows.push({
          createdAt: daysAgo(0),
          status: i === 0 ? "accepted" : "wrong_answer",
          userId: `u${i}`,
          language: "cpp",
          problemId: `p${p}`,
        });
      }
    }
    rows.push({
      createdAt: daysAgo(0),
      status: "accepted",
      userId: "u0",
      language: "cpp",
      problemId: "p_private",
    });
    findForPlatformStats.mockResolvedValue(rows);
    findPublicMiniByIds.mockResolvedValue(
      Array.from({ length: 10 }, (_, p) => ({ id: `p${p}`, displayId: p, title: `P${p}` })),
    );

    const overview = await getPlatformOverview();

    const requestedIds = findPublicMiniByIds.mock.calls[0]?.[0] as string[];
    expect(requestedIds).toContain("p_private");
    expect(overview.hotProblems).toHaveLength(8);
    expect(overview.hotProblems[0]).toEqual({
      id: "p9",
      displayId: 9,
      title: "P9",
      attempts: 10,
      accepted: 1,
    });
    expect(overview.hotProblems.map((p) => p.id)).not.toContain("p_private");
    expect(overview.hotProblems.map((p) => p.attempts)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
  });
});

describe("getPlatformOverview — caching", () => {
  it("returns the cached overview without touching the database", async () => {
    const cached = {
      totals: { users: 5, publicProblems: 2, submissions30d: 1, acRate30d: 100 },
      daily: [{ day: "2026-07-10", label: "07-10", total: 1, accepted: 1, activeUsers: 1 }],
      byVerdict: [{ status: "accepted", count: 1 }],
      byLanguage: [{ language: "cpp", count: 1 }],
      hotProblems: [],
    };
    redisGet.mockResolvedValue(JSON.stringify(cached));

    const overview = await getPlatformOverview();

    expect(overview).toEqual(cached);
    expect(countAll).not.toHaveBeenCalled();
    expect(findForPlatformStats).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("recomputes when the cached payload is malformed and writes the fresh result", async () => {
    redisGet.mockResolvedValue("{not json");

    const overview = await getPlatformOverview();

    expect(overview.daily).toHaveLength(30);
    expect(findForPlatformStats).toHaveBeenCalledOnce();
    expect(redisSet).toHaveBeenCalledWith(
      "nojv:cache:platform-overview",
      JSON.stringify(overview),
      "EX",
      300,
    );
    expect(redisDel).toHaveBeenCalledWith("nojv:cache:platform-overview-lock");
  });

  it("polls the cache instead of recomputing when another request holds the lock", async () => {
    const cached = {
      totals: { users: 5, publicProblems: 2, submissions30d: 1, acRate30d: 100 },
      daily: [{ day: "2026-07-10", label: "07-10", total: 1, accepted: 1, activeUsers: 1 }],
      byVerdict: [{ status: "accepted", count: 1 }],
      byLanguage: [{ language: "cpp", count: 1 }],
      hotProblems: [],
    };
    redisSet.mockResolvedValue(null);
    redisGet.mockResolvedValueOnce(null).mockResolvedValue(JSON.stringify(cached));

    const overview = await getPlatformOverview();

    expect(overview).toEqual(cached);
    expect(findForPlatformStats).not.toHaveBeenCalled();
  });

  it("falls through to the database when redis reads and writes fail", async () => {
    countAll.mockResolvedValue(3);
    redisGet.mockRejectedValue(new Error("redis down"));
    redisSet.mockRejectedValue(new Error("redis down"));

    const overview = await getPlatformOverview();

    expect(overview.totals.users).toBe(3);
  });
});
