import { computeProblemCountPenalty } from "./problem-count";

export interface BestScoreState {
  totalScore: number;
  subtaskScores: Record<string, number>;
}

export function computeBestScoreState(args: {
  submissions: readonly { problemId: string; score: number }[];
  problemIds: ReadonlySet<string>;
  overrides: readonly { userId: string; problemId: string; overrideScore: number }[];
  userId: string;
}): BestScoreState {
  const { submissions, problemIds, overrides, userId } = args;

  const bestByProblem = new Map<string, number>();
  for (const sub of submissions) {
    if (!problemIds.has(sub.problemId)) continue;
    const current = bestByProblem.get(sub.problemId) ?? 0;
    if (sub.score > current) bestByProblem.set(sub.problemId, sub.score);
  }

  for (const row of overrides) {
    if (row.userId !== userId) continue;
    if (!problemIds.has(row.problemId)) continue;
    bestByProblem.set(row.problemId, row.overrideScore);
  }

  let totalScore = 0;
  const subtaskScores: Record<string, number> = {};
  for (const [problemId, best] of bestByProblem) {
    totalScore += best;
    subtaskScores[problemId] = best;
  }

  return { totalScore, subtaskScores };
}

export interface ProblemCountState {
  score: number;
  penaltySeconds: number;
}

export function computeProblemCountState(args: {
  submissions: readonly { problemId: string; status: string; createdAt: Date }[];
  problemIds: ReadonlySet<string>;
  problemPoints: ReadonlyMap<string, number>;
  startsAt: Date;
  penaltyPerWrongSec?: number;
  usePoints?: boolean;
}): ProblemCountState {
  const { submissions, problemIds, problemPoints, startsAt, penaltyPerWrongSec } = args;
  const usePoints = args.usePoints ?? false;

  const byProblem = new Map<string, { status: string; createdAt: Date }[]>();
  for (const sub of submissions) {
    if (!problemIds.has(sub.problemId)) continue;
    const existing = byProblem.get(sub.problemId) ?? [];
    existing.push(sub);
    byProblem.set(sub.problemId, existing);
  }

  let score = 0;
  let totalPenalty = 0;
  for (const [problemId, problemSubs] of byProblem) {
    const { solved, penaltySeconds } = computeProblemCountPenalty(
      problemSubs,
      startsAt,
      penaltyPerWrongSec,
    );
    if (solved) {
      score += usePoints ? (problemPoints.get(problemId) ?? 0) : 1;
      totalPenalty += penaltySeconds;
    }
  }

  return { score, penaltySeconds: totalPenalty };
}
