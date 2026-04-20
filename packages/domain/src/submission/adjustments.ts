import type { AdjustmentRule, AdjustmentRules } from "@nojv/core";

export interface AdjustmentInputs {
  rules: AdjustmentRules | null;
  submittedAt: Date;
  /** Soft deadline — used as `startFrom: "due"` anchor. */
  dueAt: Date | null;
  /** Hard close of the assessment — used as `startFrom: "final_day"` anchor and by `final_day_zero`. */
  finalDay: Date | null;
  runtimeMs: number;
  rawScore: number;
}

// Rules run in array order; the running score is clamped to [0, 100] at each step.
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

    if (rule.type === "time_bonus") {
      // `baselineMs > 0` guards against a divide-by-zero that would produce NaN and wipe the score.
      if (rule.baselineMs > 0 && runtimeMs >= 0) {
        const ratio = Math.max(0, 1 - runtimeMs / rule.baselineMs);
        const bonus = ratio * rule.maxBonusPercent;
        score = score + bonus;
      }
    } else if (rule.type === "flat_late_penalty") {
      const anchor = resolveAnchor(rule.startFrom, dueAt, finalDay, rule.type);
      if (anchor && submittedAt > anchor) {
        score = score * (1 - rule.penaltyPct / 100);
      }
    } else if (rule.type === "daily_late_penalty") {
      // `daysLate = 0` (inside the first 24h window) keeps a submission penalty-free.
      const anchor = resolveAnchor(rule.startFrom, dueAt, finalDay, rule.type);
      if (anchor && submittedAt > anchor) {
        const msLate = submittedAt.getTime() - anchor.getTime();
        const daysLate = Math.floor(msLate / (24 * 60 * 60 * 1000));
        if (daysLate >= 1) {
          const multiplier = Math.max(0, 1 - (daysLate * rule.perDayPct) / 100);
          score = score * multiplier;
        }
      }
    } else {
      // `final_day_zero`: a missing `closesAt` anchor must not silently zero everything.
      if (!finalDay) {
        warnMissingAnchor(rule.type, "final_day");
      } else if (submittedAt > finalDay) {
        score = 0;
      }
    }

    score = clampScore(score);
    if (score !== before) {
      log.push({ rule: rule.type, delta: score - before });
    }
  }

  return { score, adjustments: log };
}

// Returns `null` (and logs once per missing anchor kind) when the assessment context lacks the field.
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
