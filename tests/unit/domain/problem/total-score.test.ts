import { beforeEach, describe, expect, it, vi } from "vitest";

const { findScoringInputsByIds } = vi.hoisted(() => ({
  findScoringInputsByIds: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  problemRepo: { findScoringInputsByIds },
}));

import { computeProblemTotalScore, getProblemTotalScores } from "@nojv/application";

describe("computeProblemTotalScore", () => {
  it("sums subtask weights for standard problems", () => {
    expect(
      computeProblemTotalScore({
        type: "full_source",
        testcaseSets: [{ weight: 80 }, { weight: 120 }],
      }),
    ).toBe(200);
  });
  it("returns 100 for special_env (advanced) problems with no advancedConfig", () => {
    expect(computeProblemTotalScore({ type: "special_env", testcaseSets: [] })).toBe(100);
  });
  it("returns the declared maxScore for special_env problems", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: {
          run: { imageRef: "run:latest", imageSource: "registry" },
          grade: { imageRef: "grade:latest", imageSource: "registry" },
          network: { mode: "none" },
          maxScore: 250,
        },
      }),
    ).toBe(250);
  });
  it("returns 100 for special_env when advancedConfig is invalid", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: { bogus: true },
      }),
    ).toBe(100);
  });
  it("defaults special_env maxScore to 100 when advancedConfig omits it", () => {
    expect(
      computeProblemTotalScore({
        type: "special_env",
        testcaseSets: [],
        advancedConfig: {
          run: { imageRef: "run:latest", imageSource: "registry" },
          grade: { imageRef: "grade:latest", imageSource: "registry" },
        },
      }),
    ).toBe(100);
  });
  it("returns 100 when a standard problem has no testcase sets yet", () => {
    expect(computeProblemTotalScore({ type: "full_source", testcaseSets: [] })).toBe(100);
  });
});

describe("getProblemTotalScores", () => {
  beforeEach(() => findScoringInputsByIds.mockReset());

  it("returns an empty map without querying when no ids are given", async () => {
    const out = await getProblemTotalScores([]);
    expect(out.size).toBe(0);
    expect(findScoringInputsByIds).not.toHaveBeenCalled();
  });

  it("maps each problem id to its live cumulative max score", async () => {
    findScoringInputsByIds.mockResolvedValue([
      {
        id: "p1",
        type: "full_source",
        advancedConfig: null,
        testcaseSets: [{ weight: 30 }, { weight: 70 }],
      },
      { id: "p2", type: "special_env", advancedConfig: null, testcaseSets: [] },
    ]);
    const out = await getProblemTotalScores(["p1", "p2", "p1"]);
    expect(findScoringInputsByIds).toHaveBeenCalledWith(["p1", "p2"]);
    expect(out.get("p1")).toBe(100);
    expect(out.get("p2")).toBe(100);
  });
});
