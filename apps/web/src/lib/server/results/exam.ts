import type { examDomain } from "@nojv/domain";

import { buildScoreStats, type ScoreStats } from "../shared/score-stats";

export interface ExamResultProblemCol {
  id: string;
  letter: string;
  title: string;
  max: number;
}

export interface ExamResultRow {
  rank: number;
  user: string;
  sid: string;
  total: number;
  scores: number[];
  me: boolean;
}

export interface ExamResults extends ScoreStats {
  problems: ExamResultProblemCol[];
  rows: ExamResultRow[];
}

export function buildExamResults(
  matrix: examDomain.ExamSubmissionsMatrix,
  viewerUserId: string,
): ExamResults {
  const problems: ExamResultProblemCol[] = matrix.problems.map((p) => ({
    id: p.problemId,
    letter: p.letter,
    title: p.title,
    max: p.points,
  }));

  // Sort by total desc; ties share rank.
  const sortedRows = [...matrix.rows].sort((a, b) => b.total - a.total);
  let lastTotal = -1;
  let lastRank = 0;
  const rows: ExamResultRow[] = sortedRows.map((r, idx) => {
    const rank = r.total === lastTotal ? lastRank : idx + 1;
    lastTotal = r.total;
    lastRank = rank;
    return {
      rank,
      user: r.displayName || r.handle || r.userId,
      sid: r.handle,
      total: r.total,
      scores: r.cells.map((c) => c.score ?? 0),
      me: r.userId === viewerUserId,
    };
  });

  const totals = rows.map((r) => r.total);
  const stats = buildScoreStats(totals, matrix.studentCount, matrix.totalPoints);

  return { ...stats, problems, rows };
}
