import type { AdjustmentRule, AdjustmentRules } from "@nojv/core";

export interface AdjustmentInputs {
  rules: AdjustmentRules | null;
  submittedAt: Date;
  dueAt: Date | null;
  finalDay: Date | null;
  runtimeMs: number;
  rawScore: number;
}

export function applyAdjustmentRules(inputs: AdjustmentInputs): {
  score: number;
  adjustments: { rule: AdjustmentRule["type"]; delta: number }[];
} {
  const { rules, submittedAt, dueAt, finalDay, runtimeMs, rawScore } = inputs;
  if (!rules || rules.length === 0) {
    return { score: clampScore(rawScore), adjustments: [] };
  }

  let score = rawScore;
  const log: { rule: AdjustmentRule["type"]; delta: number }[] = [];

  for (const rule of rules) {
    const before = score;

    score = applyRule(rule, score, { submittedAt, dueAt, finalDay, runtimeMs });

    score = clampScore(score);
    if (score !== before) {
      log.push({ rule: rule.type, delta: score - before });
    }
  }

  return { score, adjustments: log };
}

interface RuleContext {
  submittedAt: Date;
  dueAt: Date | null;
  finalDay: Date | null;
  runtimeMs: number;
}

function applyRule(rule: AdjustmentRule, score: number, ctx: RuleContext): number {
  const { submittedAt, dueAt, finalDay, runtimeMs } = ctx;

  if (rule.type === "time_bonus") {
    if (rule.baselineMs > 0 && runtimeMs >= 0) {
      const ratio = Math.max(0, 1 - runtimeMs / rule.baselineMs);
      const bonus = ratio * rule.maxBonusPercent;
      return score + bonus;
    }
    return score;
  }

  if (rule.type === "flat_late_penalty") {
    const anchor = resolveAnchor(rule.startFrom, dueAt, finalDay, rule.type);
    if (anchor && submittedAt > anchor) {
      return score * (1 - rule.penaltyPct / 100);
    }
    return score;
  }

  if (rule.type === "daily_late_penalty") {
    const anchor = resolveAnchor(rule.startFrom, dueAt, finalDay, rule.type);
    if (anchor && submittedAt > anchor) {
      const msLate = submittedAt.getTime() - anchor.getTime();
      const daysLate = Math.floor(msLate / (24 * 60 * 60 * 1000));
      if (daysLate >= 1) {
        const multiplier = Math.max(0, 1 - (daysLate * rule.perDayPct) / 100);
        return score * multiplier;
      }
    }
    return score;
  }

  if (!finalDay) {
    warnMissingAnchor(rule.type, "final_day");
  } else if (submittedAt > finalDay) {
    return 0;
  }
  return score;
}

function resolveAnchor(
  startFrom: "due" | "final_day",
  dueAt: Date | null,
  finalDay: Date | null,
  ruleType: AdjustmentRule["type"],
): Date | null {
  if (startFrom === "due") {
    if (!dueAt) {
      warnMissingAnchor(ruleType, "due");
      return null;
    }
    return dueAt;
  }
  if (!finalDay) {
    warnMissingAnchor(ruleType, "final_day");
    return null;
  }
  return finalDay;
}

const warnedAnchors = new Set<string>();
function warnMissingAnchor(ruleType: AdjustmentRule["type"], anchor: "due" | "final_day") {
  const key = `${ruleType}:${anchor}`;
  if (warnedAnchors.has(key)) return;
  warnedAnchors.add(key);
  console.warn(
    `[adjustments] rule "${ruleType}" requested missing anchor "${anchor}" — skipping this rule for affected submissions`,
  );
}

function clampScore(s: number): number {
  if (Number.isNaN(s)) return 0;
  if (s < 0) return 0;
  if (s > 100) return 100;
  return Math.round(s);
}
