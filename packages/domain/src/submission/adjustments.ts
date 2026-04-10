import type { AdjustmentRule, AdjustmentRules } from "@nojv/core";

export interface AdjustmentInputs {
  rules: AdjustmentRules | null;
  submittedAt: Date;
  dueAt: Date | null;
  runtimeMs: number;
  memoryKb?: number;
  rawScore: number;
}

// Rules run in array order; the running score is clamped to [0, 100] at each step.
export function applyAdjustmentRules(inputs: AdjustmentInputs): {
  score: number;
  adjustments: { rule: AdjustmentRule["type"]; delta: number }[];
} {
  const { rules, submittedAt, dueAt, runtimeMs, memoryKb, rawScore } = inputs;
  if (!rules || rules.length === 0) {
    return { score: clampScore(rawScore), adjustments: [] };
  }

  let score = rawScore;
  const log: { rule: AdjustmentRule["type"]; delta: number }[] = [];

  for (const rule of rules) {
    const before = score;
    if (rule.type === "late_penalty_fixed") {
      if (dueAt && submittedAt > dueAt) {
        const msLate = submittedAt.getTime() - dueAt.getTime();
        const units =
          rule.perUnit === "day"
            ? Math.ceil(msLate / (24 * 60 * 60 * 1000))
            : Math.ceil(msLate / (7 * 24 * 60 * 60 * 1000));
        const deduction = Math.min(units * rule.amount, rule.maxDeduction);
        score = score - deduction;
      }
    } else if (rule.type === "late_penalty_decay") {
      if (dueAt && submittedAt > dueAt && rule.halfLifeHours > 0) {
        const hoursLate = (submittedAt.getTime() - dueAt.getTime()) / (60 * 60 * 1000);
        const decay = Math.pow(0.5, hoursLate / rule.halfLifeHours);
        score = score * decay;
      }
    } else if (rule.type === "time_bonus") {
      if (rule.baselineMs > 0 && runtimeMs >= 0) {
        // Linearly scale: 0 bonus at baselineMs, full bonus at 0ms.
        const ratio = Math.max(0, 1 - runtimeMs / rule.baselineMs);
        const bonus = ratio * rule.maxBonusPercent;
        score = score + bonus;
      }
    } else {
      // rule.type === "memory_penalty"
      if (memoryKb !== undefined && memoryKb > 0) {
        const memoryMb = memoryKb / 1024;
        if (memoryMb > rule.thresholdMb) {
          score = score - rule.maxDeduction;
        }
      }
    }
    score = clampScore(score);
    if (score !== before) {
      log.push({ rule: rule.type, delta: score - before });
    }
  }

  return { score, adjustments: log };
}

function clampScore(s: number): number {
  if (Number.isNaN(s)) return 0;
  if (s < 0) return 0;
  if (s > 100) return 100;
  return Math.round(s);
}
