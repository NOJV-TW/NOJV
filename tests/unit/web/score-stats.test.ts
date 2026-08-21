import { describe, expect, it } from "vitest";

import { buildScoreStats } from "$lib/server/shared/score-stats";

describe("buildScoreStats", () => {
  it("buckets raw scores around the highest achieved score", () => {
    const stats = buildScoreStats([100, 0], 2, 300);

    expect(stats.buckets).toEqual([
      { label: "90-100", count: 1 },
      { label: "80-89", count: 0 },
      { label: "70-79", count: 0 },
      { label: "60-69", count: 0 },
      { label: "<60", count: 1 },
    ]);
  });

  it("expands bucket labels when the highest score is above 100", () => {
    const stats = buildScoreStats([200, 150, 0], 3, 300);

    expect(stats.buckets[0]).toEqual({ label: "180-200", count: 1 });
    expect(stats.buckets[2]).toEqual({ label: "140-159", count: 1 });
  });

  it("uses exact buckets for small discrete score ranges", () => {
    const stats = buildScoreStats([3, 2, 1, 0], 4, 3);

    expect(stats.buckets).toEqual([
      { label: "3", count: 1 },
      { label: "2", count: 1 },
      { label: "1", count: 1 },
      { label: "0", count: 1 },
    ]);
  });
});
