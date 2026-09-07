import { activityScore, sumActivityScores } from "../scoring/activity-points";
export type MatrixCellState = "ac" | "partial" | "zero" | "empty";

export interface MatrixProblemColumn {
  problemId: string;
  letter: string;
  ordinal: number;
  title: string;
  points: number;
  rawMaxScore?: number;
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

export interface AssembledMatrixParticipant {
  rowId: string;
  courseMembershipId: string | null;
  userId: string | null;
  displayName: string;
  handle: string;
}

export interface AssembledMatrixRow {
  rowId: string;
  courseMembershipId: string | null;
  userId: string | null;
  displayName: string;
  handle: string;
  cells: MatrixCell[];
  total: number;
}

export interface AssembledMatrix {
  problems: MatrixProblemColumn[];
  rows: AssembledMatrixRow[];
  totalPoints: number;
  studentCount: number;
}

function cellState(score: number, pointsMax: number): MatrixCellState {
  if (score >= pointsMax) return "ac";
  if (score > 0) return "partial";
  return "zero";
}

export function buildMatrixRowCells(opts: {
  rowId: string;
  problems: MatrixProblemColumn[];
  scoreIndex: Map<string, { best: number; count: number }>;
  overrides: Map<string, number>;
  practiceIndex?: Map<string, { best: number; count: number }>;
}): MatrixRowResult {
  const cells: MatrixCell[] = opts.problems.map((problem) => {
    const key = `${opts.rowId}::${problem.problemId}`;
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
        score:
          problem.rawMaxScore === undefined
            ? override
            : activityScore(override, problem.rawMaxScore, problem.points).toNumber(),
        attempts: hit?.count ?? 0,
        state: cellState(override, problem.rawMaxScore ?? problem.points),
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
      score:
        problem.rawMaxScore === undefined
          ? hit.best
          : activityScore(hit.best, problem.rawMaxScore, problem.points).toNumber(),
      attempts: hit.count,
      state: cellState(hit.best, problem.rawMaxScore ?? problem.points),
      ...practiceFields,
    };
  });
  const total = sumActivityScores(
    opts.problems.map((problem) => {
      const key = `${opts.rowId}::${problem.problemId}`;
      const raw = opts.overrides.get(key) ?? opts.scoreIndex.get(key)?.best ?? 0;
      return problem.rawMaxScore === undefined
        ? raw
        : activityScore(raw, problem.rawMaxScore, problem.points);
    }),
  );
  return { cells, total };
}

export function assembleMatrix(input: {
  problems: MatrixProblemColumn[];
  participants: AssembledMatrixParticipant[];
  scoreIndex: Map<string, { best: number; count: number }>;
  overrides: Map<string, number>;
  practiceIndex?: Map<string, { best: number; count: number }>;
  studentCount: number;
  totalPoints?: number;
}): AssembledMatrix {
  const totalPoints = input.totalPoints ?? input.problems.reduce((sum, p) => sum + p.points, 0);

  const rows: AssembledMatrixRow[] = input.participants.map((participant) => {
    const { cells, total } = buildMatrixRowCells({
      rowId: participant.rowId,
      problems: input.problems,
      scoreIndex: input.scoreIndex,
      overrides: input.overrides,
      ...(input.practiceIndex ? { practiceIndex: input.practiceIndex } : {}),
    });
    return {
      rowId: participant.rowId,
      courseMembershipId: participant.courseMembershipId,
      userId: participant.userId,
      displayName: participant.displayName,
      handle: participant.handle,
      cells,
      total,
    };
  });

  return {
    problems: input.problems,
    rows,
    totalPoints,
    studentCount: input.studentCount,
  };
}
