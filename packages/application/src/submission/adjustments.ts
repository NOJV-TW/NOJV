import type { AdjustmentRule, AdjustmentRules } from "@nojv/core";

export interface AdjustmentInputs {
  rules: AdjustmentRules | null;
  submittedAt: Date;
  dueAt: Date | null;
  runtimeMs: number;
  rawScore: number;
  maxScore?: number;
}

export function applyAdjustmentRules(inputs: AdjustmentInputs): {
  score: number;
  adjustments: { rule: AdjustmentRule["type"]; delta: number }[];
} {
  const { rules, submittedAt, dueAt, runtimeMs, rawScore } = inputs;
  const maxScore = inputs.maxScore ?? 100;
  let score = rawScore;
  const adjustments: { rule: AdjustmentRule["type"]; delta: number }[] = [];

  for (const rule of rules ?? []) {
    const before = score;
    if (rule.type === "time_bonus") {
      if (rule.baselineMs > 0 && runtimeMs >= 0) {
        score += Math.max(0, 1 - runtimeMs / rule.baselineMs) * rule.maxBonusPercent;
      }
    } else {
      if (!dueAt) throw new Error("Late penalties require an on-time deadline.");
      if (submittedAt > dueAt) {
        const percentage =
          rule.type === "flat_late_penalty"
            ? rule.penaltyPct
            : Math.ceil((submittedAt.getTime() - dueAt.getTime()) / 86_400_000) *
              rule.perDayPct;
        score *= Math.max(0, 1 - percentage / 100);
      }
    }
    score = clampScore(score, maxScore);
    if (score !== before) adjustments.push({ rule: rule.type, delta: score - before });
  }

  return { score: clampScore(score, maxScore), adjustments };
}

function clampScore(score: number, maxScore: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.round(Math.max(0, Math.min(score, maxScore)));
}
