import { Prisma } from "@nojv/db";
import { averageActivityScores } from "../scoring/activity-points";

export interface ScoreBucket {
  label: string;
  count: number;
}

export interface ScoreStats {
  buckets: ScoreBucket[];
  submitted: number;
  total: number;
  maxScore: number;
  classAvg: number;
  median: number;
  max: number;
  min: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1] ?? 0;
    const b = sorted[mid] ?? 0;
    return new Prisma.Decimal(a).add(b).div(2).toDecimalPlaces(2).toNumber();
  }
  return sorted[mid] ?? 0;
}

export function buildScoreStats(
  scores: number[],
  studentCount: number,
  maxScore: number,
  submitted: number,
): ScoreStats {
  const totals = scores;
  const classAvg = averageActivityScores(totals);
  const med = median(totals);
  const max = totals.length > 0 ? Math.max(...totals) : 0;
  const min = totals.length > 0 ? Math.min(...totals) : 0;

  const step = new Prisma.Decimal(maxScore).div(10);
  const buckets: ScoreBucket[] =
    maxScore > 0
      ? Array.from({ length: 10 }, (_, index) => {
          const lower = step.mul(index);
          const upper = step.mul(index + 1);
          return {
            label:
              index === 9 && max > maxScore
                ? `${lower.toString()}+`
                : `${lower.toString()}–${index === 9 ? "" : "<"}${upper.toString()}`,
            count: totals.filter(
              (score) => lower.lte(score) && (index === 9 || upper.gt(score)),
            ).length,
          };
        }).reverse()
      : [];

  return {
    buckets,
    submitted,
    total: studentCount,
    maxScore,
    classAvg,
    median: med,
    max,
    min,
  };
}
