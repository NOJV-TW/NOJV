import { buildScoreStats, type ScoreStats } from "@nojv/application";

export type ContestResults = ScoreStats;

export function buildContestResults(scores: number[], maxScore: number): ContestResults {
  return buildScoreStats(scores, scores.length, maxScore);
}
