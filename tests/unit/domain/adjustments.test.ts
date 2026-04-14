import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";

const { applyAdjustmentRules } = submissionDomain;

const dueAt = new Date("2026-04-10T12:00:00Z");
const finalDay = new Date("2026-04-12T12:00:00Z");
const onTime = new Date("2026-04-10T11:00:00Z");
const exactlyOnDue = new Date("2026-04-10T12:00:00Z");
const oneHourLate = new Date("2026-04-10T13:00:00Z");
const oneDayLate = new Date("2026-04-11T12:00:01Z");
const threeDaysLate = new Date("2026-04-13T12:00:01Z");
const afterFinalDay = new Date("2026-04-12T12:00:01Z");
const beforeFinalDay = new Date("2026-04-12T11:59:59Z");

describe("applyAdjustmentRules", () => {
  it("returns the raw score unchanged when no rules are configured", () => {
    const result = applyAdjustmentRules({
      rules: null,
      submittedAt: oneHourLate,
      dueAt,
      finalDay,
      runtimeMs: 100,
      rawScore: 80
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
        finalDay,
        runtimeMs: 0,
        rawScore: 150
      }).score
    ).toBe(100);

    expect(
      applyAdjustmentRules({
        rules: null,
        submittedAt: onTime,
        dueAt,
        finalDay,
        runtimeMs: 0,
        rawScore: -5
      }).score
    ).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // time_bonus — unchanged from the pre-redesign behavior.
  // ────────────────────────────────────────────────────────────────────────

  it("does not apply time_bonus when baselineMs <= 0", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 0, maxBonusPercent: 10 }],
      submittedAt: onTime,
      dueAt,
      finalDay,
      runtimeMs: 100,
      rawScore: 80
    });
    expect(result.score).toBe(80);
  });

  it("applies time_bonus linearly between 0 and baselineMs", () => {
    // runtimeMs = baselineMs / 2 → ratio = 0.5 → bonus = 0.5 * maxBonusPercent
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 1000, maxBonusPercent: 10 }],
      submittedAt: onTime,
      dueAt,
      finalDay,
      runtimeMs: 500,
      rawScore: 80
    });
    expect(result.score).toBe(85); // 80 + 5
  });

  // ────────────────────────────────────────────────────────────────────────
  // flat_late_penalty — one-shot percentage deduction.
  // ────────────────────────────────────────────────────────────────────────

  it("does not apply flat_late_penalty when submitted on time", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20, startFrom: "due" }],
      submittedAt: onTime,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("does not apply flat_late_penalty exactly at the due instant (not strictly after)", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20, startFrom: "due" }],
      submittedAt: exactlyOnDue,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("applies flat_late_penalty as a one-shot percentage when submitted late", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 20, startFrom: "due" }],
      submittedAt: oneHourLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(80); // 100 * 0.8
  });

  it("flat_late_penalty is independent of how late (1h late == 3d late)", () => {
    const rule = { type: "flat_late_penalty", penaltyPct: 25, startFrom: "due" } as const;
    const a = applyAdjustmentRules({
      rules: [rule],
      submittedAt: oneHourLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 80
    });
    const b = applyAdjustmentRules({
      rules: [rule],
      submittedAt: threeDaysLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 80
    });
    expect(a.score).toBe(b.score);
    expect(a.score).toBe(60); // 80 * 0.75
  });

  it("flat_late_penalty clamps to 0 when penaltyPct >= 100", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 100, startFrom: "due" }],
      submittedAt: oneHourLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 80
    });
    expect(result.score).toBe(0);
  });

  it("flat_late_penalty with startFrom=final_day uses the finalDay anchor", () => {
    const rule = { type: "flat_late_penalty", penaltyPct: 50, startFrom: "final_day" } as const;
    // submittedAt is past dueAt but before finalDay → no penalty
    expect(
      applyAdjustmentRules({
        rules: [rule],
        submittedAt: oneHourLate,
        dueAt,
        finalDay,
        runtimeMs: 0,
        rawScore: 100
      }).score
    ).toBe(100);
    // submittedAt is after finalDay → penalty
    expect(
      applyAdjustmentRules({
        rules: [rule],
        submittedAt: afterFinalDay,
        dueAt,
        finalDay,
        runtimeMs: 0,
        rawScore: 100
      }).score
    ).toBe(50);
  });

  it("skips flat_late_penalty when the requested anchor is missing from context", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "flat_late_penalty", penaltyPct: 50, startFrom: "due" }],
      submittedAt: oneHourLate,
      dueAt: null,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  // ────────────────────────────────────────────────────────────────────────
  // daily_late_penalty — linear per-day deduction.
  // ────────────────────────────────────────────────────────────────────────

  it("does not apply daily_late_penalty when daysLate < 1", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10, startFrom: "due" }],
      submittedAt: oneHourLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("applies daily_late_penalty once per full day past the anchor", () => {
    // floor(24h / 24h) = 1 day → 100 * (1 - 0.10) = 90
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10, startFrom: "due" }],
      submittedAt: oneDayLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(90);
  });

  it("applies daily_late_penalty linearly across multiple days", () => {
    // 3 days late, 10% per day → 100 * (1 - 0.30) = 70
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 10, startFrom: "due" }],
      submittedAt: threeDaysLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(70);
  });

  it("daily_late_penalty clamps to 0 once the cumulative penalty exceeds 100%", () => {
    // 3 days late * 50% per day = 150% → clamped to 0
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 50, startFrom: "due" }],
      submittedAt: threeDaysLate,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(0);
  });

  it("skips daily_late_penalty when the requested anchor is missing from context", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "daily_late_penalty", perDayPct: 50, startFrom: "final_day" }],
      submittedAt: threeDaysLate,
      dueAt,
      finalDay: null,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  // ────────────────────────────────────────────────────────────────────────
  // final_day_zero — hard gate.
  // ────────────────────────────────────────────────────────────────────────

  it("does not zero the score strictly before the final day", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "final_day_zero" }],
      submittedAt: beforeFinalDay,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("does not zero the score exactly at the final day instant", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "final_day_zero" }],
      submittedAt: finalDay,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("zeroes the score strictly after the final day", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "final_day_zero" }],
      submittedAt: afterFinalDay,
      dueAt,
      finalDay,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(0);
  });

  it("skips final_day_zero when finalDay is missing from context", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "final_day_zero" }],
      submittedAt: afterFinalDay,
      dueAt,
      finalDay: null,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });
});
