import { beforeEach, describe, expect, it, vi } from "vitest";

const { findDistinctAcByUser, findRecommendations } = vi.hoisted(() => ({
  findDistinctAcByUser: vi.fn(),
  findRecommendations: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { findDistinctAcByUser },
  problemRepo: { findRecommendations },
}));

import { userDomain } from "@nojv/domain";

const { getSuggestedProblems } = userDomain;

beforeEach(() => {
  findDistinctAcByUser.mockReset();
  findRecommendations.mockReset();
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
