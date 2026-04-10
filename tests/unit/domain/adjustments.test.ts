import { describe, expect, it } from "vitest";

import { submissionDomain } from "@nojv/domain";

const { applyAdjustmentRules } = submissionDomain;

const dueAt = new Date("2026-04-10T12:00:00Z");
const onTime = new Date("2026-04-10T11:00:00Z");
const oneHourLate = new Date("2026-04-10T13:00:00Z");

describe("applyAdjustmentRules", () => {
  it("returns the raw score unchanged when no rules are configured", () => {
    const result = applyAdjustmentRules({
      rules: null,
      submittedAt: oneHourLate,
      dueAt,
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
        runtimeMs: 0,
        rawScore: 150
      }).score
    ).toBe(100);

    expect(
      applyAdjustmentRules({
        rules: null,
        submittedAt: onTime,
        dueAt,
        runtimeMs: 0,
        rawScore: -5
      }).score
    ).toBe(0);
  });

  it("does not apply late_penalty_decay when submission is on time", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "late_penalty_decay", halfLifeHours: 24 }],
      submittedAt: onTime,
      dueAt,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("applies late_penalty_decay when submission is late", () => {
    // halfLifeHours=1 → 1h late should halve the score (within rounding).
    const result = applyAdjustmentRules({
      rules: [{ type: "late_penalty_decay", halfLifeHours: 1 }],
      submittedAt: oneHourLate,
      dueAt,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(50);
  });

  it("regression: late_penalty_decay with halfLifeHours=0 must NOT collapse the score to 0", () => {
    // Round 2 bug: Math.pow(0.5, hoursLate / 0) = 0 wiped out the score.
    // Schema enforces halfLifeHours >= 1 on creation, but stale rows could
    // still trigger this. The runtime guard added in round 2 should skip
    // the rule when halfLifeHours <= 0.
    const result = applyAdjustmentRules({
      rules: [{ type: "late_penalty_decay", halfLifeHours: 0 }],
      submittedAt: oneHourLate,
      dueAt,
      runtimeMs: 0,
      rawScore: 100
    });
    expect(result.score).toBe(100);
  });

  it("does not apply time_bonus when baselineMs <= 0", () => {
    const result = applyAdjustmentRules({
      rules: [{ type: "time_bonus", baselineMs: 0, maxBonusPercent: 10 }],
      submittedAt: onTime,
      dueAt,
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
      runtimeMs: 500,
      rawScore: 80
    });
    expect(result.score).toBe(85); // 80 + 5
  });

  it("applies late_penalty_fixed in day units, capped by maxDeduction", () => {
    const oneDayLate = new Date(dueAt.getTime() + 25 * 60 * 60 * 1000);
    const result = applyAdjustmentRules({
      rules: [
        {
          type: "late_penalty_fixed",
          perUnit: "day",
          amount: 10,
          maxDeduction: 50
        }
      ],
      submittedAt: oneDayLate,
      dueAt,
      runtimeMs: 0,
      rawScore: 100
    });
    // ceil(25h / 24h) = 2 units → 2 * 10 = 20 deduction
    expect(result.score).toBe(80);
  });
});
