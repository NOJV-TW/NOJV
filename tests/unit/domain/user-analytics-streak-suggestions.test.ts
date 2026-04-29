import { beforeEach, describe, expect, it, vi } from "vitest";

const { findRange, findDistinctAcByUser, findRecommendations } = vi.hoisted(() => ({
  findRange: vi.fn(),
  findDistinctAcByUser: vi.fn(),
  findRecommendations: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  userDailyActivityRepo: { findRange },
  submissionRepo: { findDistinctAcByUser },
  problemRepo: { findRecommendations },
}));

import { userDomain } from "@nojv/domain";

const { getStreakDays, getSuggestedProblems } = userDomain;

beforeEach(() => {
  findRange.mockReset();
  findDistinctAcByUser.mockReset();
  findRecommendations.mockReset();
});

// Helper — build a UserDailyActivity row at a given UTC offset from `today`.
function activityRow(today: Date, daysBack: number, acCount: number) {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const date = new Date(today.getTime() - daysBack * oneDayMs);
  return { date, acCount, submissionCount: acCount };
}

describe("getStreakDays", () => {
  // Pin "now" so tests are deterministic regardless of when they run.
  const NOW = new Date("2026-04-30T15:00:00Z");
  const TODAY = new Date(Date.UTC(2026, 3, 30));

  it("returns 0 when the user has no activity at all", async () => {
    findRange.mockResolvedValue([]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(0);
  });

  it("returns N for N consecutive AC days ending today", async () => {
    findRange.mockResolvedValue([
      activityRow(TODAY, 0, 1),
      activityRow(TODAY, 1, 2),
      activityRow(TODAY, 2, 1),
    ]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(3);
  });

  it("breaks the streak at the first day with acCount === 0", async () => {
    findRange.mockResolvedValue([
      activityRow(TODAY, 0, 1),
      activityRow(TODAY, 1, 1),
      // Day 2 missing entirely (treated as 0)
      activityRow(TODAY, 3, 1),
      activityRow(TODAY, 4, 1),
    ]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(2);
  });

  it("grace day: today empty + yesterday has AC counts the streak from yesterday", async () => {
    findRange.mockResolvedValue([
      activityRow(TODAY, 1, 1),
      activityRow(TODAY, 2, 1),
      activityRow(TODAY, 3, 1),
    ]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(3);
  });

  it("returns 0 when both today and yesterday are empty", async () => {
    findRange.mockResolvedValue([
      // older AC, but the chain is broken
      activityRow(TODAY, 5, 1),
      activityRow(TODAY, 6, 1),
    ]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(0);
  });

  it("treats a row with acCount === 0 as a gap even when submissionCount > 0", async () => {
    findRange.mockResolvedValue([
      activityRow(TODAY, 0, 1),
      { ...activityRow(TODAY, 1, 0), submissionCount: 5 },
      activityRow(TODAY, 2, 1),
    ]);
    const streak = await getStreakDays("usr_1", NOW);
    expect(streak).toBe(1);
  });
});

describe("getSuggestedProblems", () => {
  it("returns [] when the user has no AC submissions", async () => {
    findDistinctAcByUser.mockResolvedValue([]);
    const out = await getSuggestedProblems("usr_1");
    expect(out).toEqual([]);
    expect(findRecommendations).not.toHaveBeenCalled();
  });

  it("returns [] when AC submissions exist but every problem has no tags", async () => {
    findDistinctAcByUser.mockResolvedValue([
      { problemId: "p1", problem: { tags: [], difficulty: "easy" } },
    ]);
    const out = await getSuggestedProblems("usr_1");
    expect(out).toEqual([]);
    expect(findRecommendations).not.toHaveBeenCalled();
  });

  it("excludes solved problems and ranks unsolved by tag-overlap weight", async () => {
    findDistinctAcByUser.mockResolvedValue([
      { problemId: "p1", problem: { tags: ["dp", "graph"], difficulty: "easy" } },
      { problemId: "p2", problem: { tags: ["dp"], difficulty: "medium" } },
    ]);
    findRecommendations.mockResolvedValue([
      // Two of user's strongest tags → highest overlap
      { id: "p10", title: "DP graph problem", tags: ["dp", "graph"], difficulty: "hard" },
      // One overlapping tag
      { id: "p11", title: "DP only", tags: ["dp", "math"], difficulty: "easy" },
      // No overlap — should be filtered
      { id: "p12", title: "Unrelated", tags: ["string"], difficulty: "easy" },
    ]);

    const out = await getSuggestedProblems("usr_1");

    expect(out.map((p) => p.id)).toEqual(["p10", "p11"]);
    expect(out[0]?.tags).toEqual(["dp", "graph"]);
    // Sanity — solved IDs were forwarded as exclusion list.
    expect(findRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: ["p1", "p2"] }),
    );
  });

  it("breaks ties on overlap by ascending difficulty (easy before hard)", async () => {
    findDistinctAcByUser.mockResolvedValue([
      { problemId: "p1", problem: { tags: ["dp"], difficulty: "easy" } },
    ]);
    findRecommendations.mockResolvedValue([
      { id: "p20", title: "Hard DP", tags: ["dp"], difficulty: "hard" },
      { id: "p21", title: "Medium DP", tags: ["dp"], difficulty: "medium" },
      { id: "p22", title: "Easy DP", tags: ["dp"], difficulty: "easy" },
    ]);

    const out = await getSuggestedProblems("usr_1");
    expect(out.map((p) => p.id)).toEqual(["p22", "p21", "p20"]);
  });

  it("respects the limit argument", async () => {
    findDistinctAcByUser.mockResolvedValue([
      { problemId: "p1", problem: { tags: ["dp"], difficulty: "easy" } },
    ]);
    findRecommendations.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        title: `Problem ${i}`,
        tags: ["dp"],
        difficulty: "easy" as const,
      })),
    );

    const out = await getSuggestedProblems("usr_1", 3);
    expect(out).toHaveLength(3);
  });
});
