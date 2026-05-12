import { buildScoreStats, type ScoreStats } from "../shared/score-stats";

export type ContestResults = ScoreStats;

export function buildContestResults(scores: number[], maxScore: number): ContestResults {
  return buildScoreStats(scores, scores.length, maxScore);
}
