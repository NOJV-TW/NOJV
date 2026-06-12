export type MatrixCellState = "ac" | "partial" | "zero" | "empty";

export interface MatrixProblemColumn {
  problemId: string;
  letter: string;
  ordinal: number;
  title: string;
  points: number;
}

export interface MatrixCell {
  problemId: string;
  score: number | null;
  attempts: number;
  state: MatrixCellState;
  practiceScore: number | null;
  practiceAttempts: number;
}

export interface MatrixRowResult {
  cells: MatrixCell[];
  total: number;
}

function cellState(score: number, pointsMax: number): MatrixCellState {
  if (score >= pointsMax) return "ac";
  if (score > 0) return "partial";
  return "zero";
}

export function buildMatrixRowCells(opts: {
  userId: string;
  problems: MatrixProblemColumn[];
  scoreIndex: Map<string, { best: number; count: number }>;
  overrides: Map<string, number>;
  practiceIndex?: Map<string, { best: number; count: number }>;
}): MatrixRowResult {
  const cells: MatrixCell[] = opts.problems.map((problem) => {
    const key = `${opts.userId}::${problem.problemId}`;
    const override = opts.overrides.get(key);
    const hit = opts.scoreIndex.get(key);
    const practice = opts.practiceIndex?.get(key);
    const practiceFields = {
      practiceScore: practice?.best ?? null,
      practiceAttempts: practice?.count ?? 0,
    };
    if (override !== undefined) {
      return {
        problemId: problem.problemId,
        score: override,
        attempts: hit?.count ?? 0,
        state: cellState(override, problem.points),
        ...practiceFields,
      };
    }
    if (!hit || hit.count === 0) {
      return {
        problemId: problem.problemId,
        score: null,
        attempts: 0,
        state: "empty",
        ...practiceFields,
      };
    }
    return {
      problemId: problem.problemId,
      score: hit.best,
      attempts: hit.count,
      state: cellState(hit.best, problem.points),
      ...practiceFields,
    };
  });
  const total = cells.reduce((sum, c) => sum + (c.score ?? 0), 0);
  return { cells, total };
}
