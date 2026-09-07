import type { ActivityProblem } from "@nojv/core";

export function equalActivityWeights(
  problems: ActivityProblem[],
  totalPoints: number,
): ActivityProblem[] {
  if (!problems.length) return [];
  const base = Math.floor(10_000 / problems.length);
  const remainder = 10_000 % problems.length;
  return problems.map((p, i) => ({
    ...p,
    points: Number(((totalPoints * (base + (i < remainder ? 1 : 0))) / 10_000).toFixed(8)),
  }));
}

export function rescaleActivityWeights(
  problems: ActivityProblem[],
  oldTotal: number,
  newTotal: number,
): ActivityProblem[] {
  if (oldTotal <= 0 || !Number.isFinite(newTotal) || newTotal <= 0) return problems;
  const scaled = problems.map((p) => ({
    ...p,
    points: Number(((p.points / oldTotal) * newTotal).toFixed(8)),
  }));
  const last = scaled.findLastIndex((p) => p.points > 0);
  const allocated = problems.reduce((sum, p) => sum + p.points, 0);
  const lastProblem = scaled[last];
  if (lastProblem && Math.abs(allocated - oldTotal) < 0.00000001) {
    lastProblem.points = Number(
      (newTotal - scaled.reduce((sum, p, i) => sum + (i === last ? 0 : p.points), 0)).toFixed(
        8,
      ),
    );
  }
  return scaled;
}
