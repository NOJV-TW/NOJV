import { Prisma } from "@nojv/db";
import { activityProblemsSchema } from "@nojv/core";
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

export function activityTotalPoints(problems: readonly { points: number }[]): Prisma.Decimal {
  return problems.reduce((sum, p) => sum.add(p.points), new Prisma.Decimal(0));
}

export function assertActivityAllocation(
  problems: readonly { problemId: string; points: number }[],
  published: boolean,
): Prisma.Decimal {
  const rows = activityProblemsSchema.safeParse(problems);
  if (!rows.success) throw new ValidationError("Invalid problem allocation.");
  const total = activityTotalPoints(problems);
  if (published && total.lte(0)) {
    throw new ValidationError(
      "Add at least one problem worth points before publishing or saving a published activity.",
    );
  }
  return total;
}
