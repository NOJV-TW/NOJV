import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findRecentByUser,
  findDistinctAcByUser,
  count,
  groupByLanguageForUser,
  groupByStatusForUser,
} = vi.hoisted(() => ({
  findRecentByUser: vi.fn(),
  findDistinctAcByUser: vi.fn(),
  count: vi.fn(),
  groupByLanguageForUser: vi.fn(),
  groupByStatusForUser: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: {
    findRecentByUser,
    findDistinctAcByUser,
    count,
    groupByLanguageForUser,
    groupByStatusForUser,
  },
  userRepo: {},
}));

import { userDomain } from "@nojv/domain";

const { getDashboardView } = userDomain;

beforeEach(() => {
  findRecentByUser.mockReset();
  findDistinctAcByUser.mockReset();
  count.mockReset();
  groupByLanguageForUser.mockReset();
  groupByStatusForUser.mockReset();
});

describe("getDashboardView — empty actor", () => {
  it("returns zeroed stats and empty analytics arrays for a user with no submissions", async () => {
    findRecentByUser.mockResolvedValue([]);
    findDistinctAcByUser.mockResolvedValue([]);
    count.mockResolvedValue(0);
    groupByLanguageForUser.mockResolvedValue([]);
    groupByStatusForUser.mockResolvedValue([]);

    const view = await getDashboardView("usr_new");

    expect(view.stats).toEqual({ totalAc: 0, totalAttempts: 0 });
    expect(view.recentSubmissions).toEqual([]);
    expect(view.analytics.byLanguage).toEqual([]);
    expect(view.analytics.byVerdict).toEqual([]);
    expect(view.analytics.byTag).toEqual([]);
    expect(view.analytics.byDifficulty).toEqual([
      { difficulty: "easy", acCount: 0 },
      { difficulty: "medium", acCount: 0 },
      { difficulty: "hard", acCount: 0 },
    ]);
  });
});

describe("getDashboardView — populated actor", () => {
  it("derives totalAc from distinct-AC length and totalAttempts from count", async () => {
    findRecentByUser.mockResolvedValue([]);
    findDistinctAcByUser.mockResolvedValue([
      { problem: { difficulty: "easy", tags: ["dp"] } },
      { problem: { difficulty: "medium", tags: ["dp", "graph"] } },
      { problem: { difficulty: "medium", tags: ["math"] } },
    ]);
    count.mockResolvedValue(17);
    groupByLanguageForUser.mockResolvedValue([]);
    groupByStatusForUser.mockResolvedValue([]);

    const view = await getDashboardView("usr_1");

    expect(view.stats).toEqual({ totalAc: 3, totalAttempts: 17 });
  });

  it("emits byDifficulty in fixed easy→medium→hard order with per-bucket counts", async () => {
    findRecentByUser.mockResolvedValue([]);
    findDistinctAcByUser.mockResolvedValue([
      { problem: { difficulty: "hard", tags: [] } },
      { problem: { difficulty: "hard", tags: [] } },
      { problem: { difficulty: "easy", tags: [] } },
    ]);
    count.mockResolvedValue(3);
    groupByLanguageForUser.mockResolvedValue([]);
    groupByStatusForUser.mockResolvedValue([]);

    const view = await getDashboardView("usr_1");

    expect(view.analytics.byDifficulty).toEqual([
      { difficulty: "easy", acCount: 1 },
      { difficulty: "medium", acCount: 0 },
      { difficulty: "hard", acCount: 2 },
    ]);
  });

  it("flattens language and verdict group-by rows into compact analytics shape", async () => {
    findRecentByUser.mockResolvedValue([]);
    findDistinctAcByUser.mockResolvedValue([]);
    count.mockResolvedValue(10);
    groupByLanguageForUser.mockResolvedValue([
      { language: "cpp", _count: { _all: 6 } },
      { language: "python", _count: { _all: 4 } },
    ]);
    groupByStatusForUser.mockResolvedValue([
      { status: "accepted", _count: { _all: 4 } },
      { status: "wrong_answer", _count: { _all: 6 } },
    ]);

    const view = await getDashboardView("usr_1");

    expect(view.analytics.byLanguage).toEqual([
      { language: "cpp", count: 6 },
      { language: "python", count: 4 },
    ]);
    expect(view.analytics.byVerdict).toEqual([
      { status: "accepted", count: 4 },
      { status: "wrong_answer", count: 6 },
    ]);
  });

  it("delegates byTag to aggregateByTag and caps at 8 (+ descending by count)", async () => {
    findRecentByUser.mockResolvedValue([]);
    findDistinctAcByUser.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        problem: { difficulty: "easy", tags: [`tag${i}`] },
      })),
    );
    count.mockResolvedValue(12);
    groupByLanguageForUser.mockResolvedValue([]);
    groupByStatusForUser.mockResolvedValue([]);

    const view = await getDashboardView("usr_1");

    expect(view.analytics.byTag).toHaveLength(8);
    view.analytics.byTag.forEach((row) => expect(row.acCount).toBe(1));
  });
});
