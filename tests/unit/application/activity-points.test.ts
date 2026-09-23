import { describe, expect, it } from "vitest";
import {
  activityScore,
  averageActivityScores,
  assertActivityAllocation,
  sumActivityScores,
} from "../../../packages/application/src/scoring/activity-points";

const problems = [
  { problemId: "a", points: 40 },
  { problemId: "b", points: 60 },
];

describe("activity weights", () => {
  it("normalizes raw scores and preserves the configured maximum", () => {
    expect(sumActivityScores([activityScore(80, 100, 40), activityScore(50, 100, 60)])).toBe(
      62,
    );
    expect(sumActivityScores([activityScore(200, 200, 40), activityScore(500, 500, 60)])).toBe(
      100,
    );
    expect(activityScore(120, 200, 40).toNumber()).toBe(24);
    expect(activityScore(100, 100, 0).toNumber()).toBe(0);
    expect(activityScore(80, 100, 80).toNumber()).toBe(64);
  });
  it("rounds only the total, preserving full credit for thirds", () => {
    expect(sumActivityScores([activityScore(1, 3, 100), activityScore(2, 3, 100)])).toBe(100);
    expect(sumActivityScores([1.005])).toBe(1.01);
    expect(sumActivityScores([activityScore(1, 24, 53), activityScore(8, 24, 47)])).toBe(17.88);
  });
  it("derives the total from the problem points and guards publishing", () => {
    expect(assertActivityAllocation(problems, true).toNumber()).toBe(100);
    expect(assertActivityAllocation([], false).toNumber()).toBe(0);
    expect(assertActivityAllocation([{ problemId: "a", points: 0 }], false).toNumber()).toBe(0);
    for (const rows of [
      [],
      [{ problemId: "a", points: 0 }],
      [
        { problemId: "a", points: 50 },
        { problemId: "a", points: 50 },
      ],
      [{ problemId: "a", points: -1 }],
    ]) {
      expect(() => assertActivityAllocation(rows, true)).toThrow();
    }
    expect(() => activityScore(100, 0, 40)).toThrow();
  });
});

it("rounds class means after exact decimal division", () => {
  expect(averageActivityScores([0.05, 0.05, 0.05, 0, 0, 0])).toBe(0.03);
  expect(averageActivityScores([])).toBe(0);
});
