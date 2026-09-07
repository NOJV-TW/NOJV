import { Prisma } from "@nojv/db";
import { activityProblemsSchema, activityTotalPointsSchema } from "@nojv/core";
import { ValidationError } from "../shared/errors";

type DecimalValue = number | Prisma.Decimal;

export function activityScore(
  rawScore: number,
  rawMax: number,
  points: DecimalValue,
): Prisma.Decimal {
  if (!Number.isFinite(rawMax) || rawMax <= 0)
    throw new ValidationError("Problem maximum must be positive.");
  return new Prisma.Decimal(rawScore).mul(points).div(rawMax);
}

export function sumActivityScores(scores: Iterable<DecimalValue>): number {
  let total = new Prisma.Decimal(0);
  for (const score of scores) total = total.add(score);
  return total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function averageActivityScores(scores: number[]): number {
  if (!scores.length) return 0;
  return scores
    .reduce((sum, score) => sum.add(score), new Prisma.Decimal(0))
    .div(scores.length)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function assertActivityAllocation(
  totalPoints: number,
  problems: readonly { problemId: string; points: number }[],
  published: boolean,
): void {
  const total = activityTotalPointsSchema.safeParse(totalPoints);
  const rows = activityProblemsSchema.safeParse(problems);
  if (!total.success || !rows.success)
    throw new ValidationError("Invalid activity total or problem allocation.");
  const allocated = problems.reduce((sum, p) => sum.add(p.points), new Prisma.Decimal(0));
  if (published && (problems.length === 0 || !allocated.eq(totalPoints))) {
    throw new ValidationError(
      "Problem weights must add up to 100% before publishing or saving a published activity.",
    );
  }
}
