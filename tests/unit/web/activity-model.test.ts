import { describe, it, expect } from "vitest";

import { buildActivityModel, type ActivityEvent } from "$lib/utils/activity";

function ev(year: number, month: number, day: number, ac: boolean): ActivityEvent {
  return { at: new Date(year, month - 1, day, 12, 0, 0).toISOString(), ac };
}

describe("buildActivityModel", () => {
  const now = new Date(2026, 4, 18, 9, 0, 0); // 2026-05-18 09:00 local

  it("returns a heatmap window of the requested length, ending today", () => {
    const model = buildActivityModel([], now, 30);
    expect(model.heatmapDays).toHaveLength(30);
    expect(model.heatmapDays[29]!.date).toBe("2026-05-18");
    expect(model.heatmapDays[0]!.date).toBe("2026-04-19");
  });

  it("buckets events into their local calendar day", () => {
    const events = [ev(2026, 5, 18, true), ev(2026, 5, 18, false), ev(2026, 5, 17, true)];
    const model = buildActivityModel(events, now, 30);
    expect(model.heatmapDays.find((d) => d.date === "2026-05-18")).toEqual({
      date: "2026-05-18",
      acCount: 1,
      submissionCount: 2,
    });
    expect(model.heatmapDays.find((d) => d.date === "2026-05-17")?.acCount).toBe(1);
  });

  it("weeklyTrend is the last 7 days of the window", () => {
    const model = buildActivityModel([], now, 30);
    expect(model.weeklyTrend).toHaveLength(7);
    expect(model.weeklyTrend[6]!.date).toBe("2026-05-18");
    expect(model.weeklyTrend[0]!.date).toBe("2026-05-12");
  });

  it("counts a streak of consecutive AC days ending today", () => {
    const events = [ev(2026, 5, 16, true), ev(2026, 5, 17, true), ev(2026, 5, 18, true)];
    expect(buildActivityModel(events, now, 30).streakDays).toBe(3);
  });

  it("applies the grace day — today empty but yesterday AC still counts", () => {
    const events = [ev(2026, 5, 16, true), ev(2026, 5, 17, true)];
    expect(buildActivityModel(events, now, 30).streakDays).toBe(2);
  });

  it("is broken when neither today nor yesterday has an AC", () => {
    const events = [ev(2026, 5, 15, true), ev(2026, 5, 16, true)];
    expect(buildActivityModel(events, now, 30).streakDays).toBe(0);
  });

  it("a non-AC submission today does not start the streak (grace falls back)", () => {
    const events = [ev(2026, 5, 17, true), ev(2026, 5, 18, false)];
    expect(buildActivityModel(events, now, 30).streakDays).toBe(1);
  });
});
