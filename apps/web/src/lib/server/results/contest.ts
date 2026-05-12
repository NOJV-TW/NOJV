import { buildScoreStats, type ScoreStats } from "../shared/score-stats";

export type ContestResultsData = ScoreStats;

export function buildContestResults(scores: number[], maxScore: number): ContestResultsData {
  return buildScoreStats(scores, scores.length, maxScore);
}
