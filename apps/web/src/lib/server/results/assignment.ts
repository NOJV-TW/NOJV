import type { courseDomain } from "@nojv/application";

import { buildScoreStats, type ScoreStats } from "@nojv/application";

export type AssignmentResults = ScoreStats;

export function buildAssignmentResults(
  matrix: courseDomain.SubmissionsMatrix,
): AssignmentResults {
  const totals = matrix.rows.map((r) => r.total);
  return {
    ...buildScoreStats(totals, matrix.studentCount, matrix.totalPoints),
    submitted: matrix.rows.filter((r) => r.cells.some((c) => c.attempts > 0)).length,
  };
}
