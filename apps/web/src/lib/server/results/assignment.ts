import type { courseDomain } from "@nojv/domain";

import { buildScoreStats, type ScoreStats } from "../shared/score-stats";

export type AssignmentResults = ScoreStats;

export function buildAssignmentResults(
  matrix: courseDomain.SubmissionsMatrix,
): AssignmentResults {
  const totals = matrix.rows.map((r) => r.total);
  return buildScoreStats(totals, matrix.studentCount, matrix.totalPoints);
}
