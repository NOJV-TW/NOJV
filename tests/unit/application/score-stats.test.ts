import { describe, expect, it } from "vitest";
import { buildScoreStats } from "@nojv/application";

describe("buildScoreStats", () => {
  it("uses ten fixed intervals even when nobody reaches the activity maximum", () => {
    const stats = buildScoreStats([100, 0], 2, 500, 1);
    expect(stats.buckets.map((b) => b.label)).toEqual([
      "450–500",
      "400–<450",
      "350–<400",
      "300–<350",
      "250–<300",
      "200–<250",
      "150–<200",
      "100–<150",
      "50–<100",
      "0–<50",
    ]);
    expect(stats.buckets.map((b) => b.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
    expect(stats.submitted).toBe(1);
  });
  it("counts every boundary once and includes the full score", () => {
    const stats = buildScoreStats(
      [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
      11,
      500,
      10,
    );
    expect(stats.buckets.map((b) => b.count)).toEqual([2, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
  it("includes bonus scores above the maximum without mislabeling the top interval", () => {
    const stats = buildScoreStats([120, 0], 2, 100, 1);
    expect(stats.buckets[0]).toEqual({ label: "90+", count: 1 });
    expect(stats.buckets[9]?.count).toBe(1);
    expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2);
  });
  it("does not infer participation from scores", () => {
    expect(buildScoreStats([0, 0, 80], 3, 100, 1).submitted).toBe(1);
    expect(buildScoreStats([0, 0], 2, 100, 2).submitted).toBe(2);
  });
  it("preserves ten precise intervals for fractional and small totals", () => {
    const stats = buildScoreStats([0, 0.3, 1.2, 2.4, 3], 5, 3, 4);
    expect(stats.buckets).toHaveLength(10);
    expect(stats.buckets[0]).toEqual({ label: "2.7–3", count: 1 });
    expect(stats.buckets[1]).toEqual({ label: "2.4–<2.7", count: 1 });
    expect(stats.buckets[8]).toEqual({ label: "0.3–<0.6", count: 1 });
    expect(stats.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(5);
    expect(buildScoreStats([0.01, 0.1], 2, 0.1, 2).buckets[8]?.count).toBe(1);
    expect(buildScoreStats([17.88], 1, 100, 1).classAvg).toBe(17.88);
    expect(buildScoreStats([17.87, 17.88], 2, 100, 2).median).toBe(17.88);
  });
  it("keeps empty intervals and handles activities without points", () => {
    expect(buildScoreStats([], 0, 100, 0).buckets).toHaveLength(10);
    expect(buildScoreStats([0, 0], 2, 100, 0).buckets[9]?.count).toBe(2);
    expect(buildScoreStats([], 0, 0, 0).buckets).toEqual([]);
  });
});
