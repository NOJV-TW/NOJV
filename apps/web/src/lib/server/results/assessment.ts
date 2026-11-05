import { buildScoreStats, type courseDomain, type ScoreStats } from "@nojv/application";

export function buildAssessmentResults(matrix: courseDomain.SubmissionsMatrix): ScoreStats {
  const totals = matrix.rows.map((r) => r.total);
  return {
    ...buildScoreStats(totals, matrix.studentCount, matrix.totalPoints),
    submitted: matrix.rows.filter((r) => r.cells.some((c) => c.attempts > 0)).length,
  };
}
