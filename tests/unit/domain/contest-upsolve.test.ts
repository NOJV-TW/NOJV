import { beforeEach, describe, expect, it, vi } from "vitest";

const { findDetailById, groupByUserAndProblem } = vi.hoisted(() => ({
  findDetailById: vi.fn(),
  groupByUserAndProblem: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findDetailById },
  submissionRepo: { groupByUserAndProblem },
}));

import { contestDomain } from "@nojv/application";

const { getUpsolveView } = contestDomain;

const ENDED_AT = new Date("2026-01-01T00:00:00.000Z");
const AFTER_END = new Date("2026-01-02T00:00:00.000Z");
const BEFORE_END = new Date("2025-12-31T00:00:00.000Z");

function fakeContest(
  problems: { id: string; ordinal: number; points: number; title: string }[],
  overrides: { visibility?: string; endsAt?: Date } = {},
) {
  return {
    id: "ctst_1",
    title: "Winter Cup",
    visibility: overrides.visibility ?? "published",
    endsAt: overrides.endsAt ?? ENDED_AT,
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

describe("getUpsolveView", () => {
  it("derives solved / attempted / untouched per problem", async () => {
    findDetailById.mockResolvedValue(
      fakeContest([
        { id: "p1", ordinal: 1, points: 100, title: "Alpha" },
        { id: "p2", ordinal: 2, points: 200, title: "Bravo" },
        { id: "p3", ordinal: 3, points: 300, title: "Charlie" },
      ]),
    );
    groupByUserAndProblem
      .mockResolvedValueOnce([{ userId: "u1", problemId: "p1" }])
      .mockResolvedValueOnce([
        { userId: "u1", problemId: "p1" },
        { userId: "u1", problemId: "p2" },
      ]);

    const view = await getUpsolveView("ctst_1", "u1", AFTER_END);

    expect(view.contestId).toBe("ctst_1");
    expect(view.title).toBe("Winter Cup");
    expect(view.endsAt).toBe(ENDED_AT.toISOString());
    expect(view.problems.map((p) => p.status)).toEqual(["solved", "attempted", "untouched"]);
    expect(view.problems[0]).toMatchObject({
      problemId: "p1",
      letter: "A",
      ordinal: 1,
      points: 100,
      title: "Alpha",
    });
  });

  it("throws NotFoundError when the contest has not ended yet", async () => {
    findDetailById.mockResolvedValue(
      fakeContest([{ id: "p1", ordinal: 1, points: 100, title: "Alpha" }]),
    );

    await expect(getUpsolveView("ctst_1", "u1", BEFORE_END)).rejects.toThrow(/not ended/i);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the contest is unpublished or missing", async () => {
    findDetailById.mockResolvedValueOnce(fakeContest([], { visibility: "draft" }));
    await expect(getUpsolveView("ctst_1", "u1", AFTER_END)).rejects.toThrow(/not found/i);

    findDetailById.mockResolvedValueOnce(null);
    await expect(getUpsolveView("ctst_x", "u1", AFTER_END)).rejects.toThrow(/not found/i);
  });

  it("returns an empty problem list without querying submissions", async () => {
    findDetailById.mockResolvedValue(fakeContest([]));

    const view = await getUpsolveView("ctst_1", "u1", AFTER_END);

    expect(view.problems).toEqual([]);
    expect(groupByUserAndProblem).not.toHaveBeenCalled();
  });
});
