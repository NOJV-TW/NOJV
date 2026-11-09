import { buildScoreStats, type courseDomain, type ScoreStats } from "@nojv/application";

export function buildAssessmentResults(matrix: courseDomain.SubmissionsMatrix): ScoreStats {
  return buildScoreStats(
    matrix.rows.map((row) => row.total),
    matrix.studentCount,
    matrix.totalPoints,
    matrix.rows.filter((row) => row.cells.some((cell) => cell.attempts > 0)).length,
  );
}
