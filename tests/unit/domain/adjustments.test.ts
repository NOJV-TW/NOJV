import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/application";

const { applyAdjustmentRules } = submissionDomain;

const dueAt = new Date("2026-04-10T12:00:00Z");
const onTime = new Date("2026-04-10T11:00:00Z");
const exactlyOnDue = new Date("2026-04-10T12:00:00Z");
const oneHourLate = new Date("2026-04-10T13:00:00Z");
const oneDayLate = new Date("2026-04-11T12:00:01Z");
const threeDaysLate = new Date("2026-04-13T12:00:01Z");

describe("applyAdjustmentRules", () => {
  it("returns the raw score unchanged when no rules are configured", () => {
    const result = applyAdjustmentRules({
      rules: null,
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 100,
      rawScore: 80,
    });
    expect(result.score).toBe(80);
    expect(result.adjustments).toEqual([]);
  });

  it("clamps the raw score to [0,100] even with no rules", () => {
    expect(
      applyAdjustmentRules({
        rules: null,
        submittedAt: onTime,
        dueAt,

        runtimeMs: 0,
        rawScore: 150,
      }).score,
    ).toBe(100);

    expect(
      applyAdjustmentRules({
        rules: null,
        submittedAt: onTime,
        dueAt,

        runtimeMs: 0,
        rawScore: -5,
      }).score,
    ).toBe(0);
  });

  it("does not apply time_bonus when baselineMs <= 0", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 0, maxBonusPercent: 10 }],
      submittedAt: onTime,
      dueAt,

      runtimeMs: 100,
      rawScore: 80,
    });
    expect(result.score).toBe(80);
  });

  it("applies time_bonus linearly between 0 and baselineMs", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 1000, maxBonusPercent: 10 }],
      submittedAt: onTime,
      dueAt,

      runtimeMs: 500,
      rawScore: 80,
    });
    expect(result.score).toBe(85); // 80 + 5
  });

  it("does not apply flat_late_penalty when submitted on time", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20 }],
      submittedAt: onTime,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(100);
  });

  it("does not apply flat_late_penalty exactly at the due instant (not strictly after)", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20 }],
      submittedAt: exactlyOnDue,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(100);
  });

  it("applies flat_late_penalty as a one-shot percentage when submitted late", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20 }],
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(80); // 100 * 0.8
  });

  it("flat_late_penalty is independent of how late (1h late == 3d late)", () => {
    const rule = { type: "flat_late_penalty", penaltyPct: 25 } as const;
    const a = applyAdjustmentRules({
      rules: [rule],
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 80,
    });
    const b = applyAdjustmentRules({
      rules: [rule],
      submittedAt: threeDaysLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 80,
    });
    expect(a.score).toBe(b.score);
    expect(a.score).toBe(60); // 80 * 0.75
  });

  it("flat_late_penalty clamps to 0 when penaltyPct >= 100", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 100 }],
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 80,
    });
    expect(result.score).toBe(0);
  });

  it("counts a partial first day for daily_late_penalty", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10 }],
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(90);
  });

  it("counts a partial second day for daily_late_penalty", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10 }],
      submittedAt: oneDayLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(80);
  });

  it("applies daily_late_penalty linearly across multiple days", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10 }],
      submittedAt: threeDaysLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(60);
  });

  it("daily_late_penalty clamps to 0 once the cumulative penalty exceeds 100%", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 50 }],
      submittedAt: threeDaysLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 100,
    });
    expect(result.score).toBe(0);
  });

  it("scales a late penalty off the problem total (maxScore: 200), not 100", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20 }],
      submittedAt: oneHourLate,
      dueAt,

      runtimeMs: 0,
      rawScore: 200,
      maxScore: 200,
    });
    expect(result.score).toBe(160); // 200 * 0.8, not capped at 100
  });

  it("clamps a perfect-score bonus to the problem total (maxScore: 200), not 100", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 1000, maxBonusPercent: 50 }],
      submittedAt: onTime,
      dueAt,

      runtimeMs: 0,
      rawScore: 200,
      maxScore: 200,
    });
    expect(result.score).toBe(200); // 200 + 50 bonus clamped to 200, not 100
  });

  it("clamps the raw score to [0, maxScore] when maxScore is supplied and no rules", () => {
    expect(
      applyAdjustmentRules({
        rules: null,
        submittedAt: onTime,
        dueAt,

        runtimeMs: 0,
        rawScore: 250,
        maxScore: 200,
      }).score,
    ).toBe(200);
  });
  it.each([
    [-1, 80],
    [0, 80],
    [1, 72],
    [86_400_000, 72],
    [86_400_001, 64],
    [172_800_000, 64],
    [864_000_000, 0],
  ])("rounds each started late day up (%i ms => %i)", (elapsed, expected) => {
    expect(
      applyAdjustmentRules({
        rules: [{ type: "daily_late_penalty", perDayPct: 10 }],
        dueAt,
        submittedAt: new Date(dueAt.getTime() + elapsed),
        rawScore: 80,
        runtimeMs: 0,
      }).score,
    ).toBe(expected);
  });

  it("rejects a late rule missing its required deadline", () => {
    expect(() =>
      applyAdjustmentRules({
        rules: [{ type: "daily_late_penalty", perDayPct: 10 }],
        dueAt: null,
        submittedAt: oneHourLate,
        rawScore: 80,
        runtimeMs: 0,
      }),
    ).toThrow("on-time deadline");
  });
});
