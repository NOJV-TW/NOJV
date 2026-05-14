import { submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import {
  buildMatrixRowCells,
  type MatrixCell,
  type MatrixCellState,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";
import type { ContestProblemSummary } from "./queries";

export type ContestMatrixCellState = MatrixCellState;
export type ContestMatrixProblemColumn = MatrixProblemColumn;
export type ContestMatrixCell = MatrixCell;

export interface ContestMatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: ContestMatrixCell[];
  total: number;
}

export interface ContestSubmissionsMatrix {
  problems: ContestMatrixProblemColumn[];
  rows: ContestMatrixRow[];
  totalPoints: number;
  studentCount: number;
}

export interface ContestMatrixParticipant {
  userId: string;
  user: { id: string; name: string; username: string | null };
}

export interface BuildContestMatrixInput {
  contestId: string;
  problems: ContestProblemSummary[];
  participants: ContestMatrixParticipant[];
}

export async function buildContestSubmissionsMatrix(
  input: BuildContestMatrixInput,
): Promise<ContestSubmissionsMatrix> {
  const problems: ContestMatrixProblemColumn[] = input.problems.map((p) => ({
    problemId: p.id,
    letter: problemLetter(p.ordinal),
    ordinal: p.ordinal,
    title: p.title,
    points: p.points,
  }));
  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  if (input.participants.length === 0 || problems.length === 0) {
    return {
      problems,
      rows: [],
      totalPoints,
      studentCount: input.participants.length,
    };
  }

  const userIds = input.participants.map((p) => p.userId);
  const problemIds = problems.map((p) => p.problemId);

  const grouped = await submissionRepo.groupByUserAndProblem({
    contestId: input.contestId,
    userId: { in: userIds },
    problemId: { in: problemIds },
    sampleOnly: false,
  });

  const scoreIndex = new Map<string, { best: number; count: number }>();
  for (const g of grouped) {
    scoreIndex.set(`${g.userId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }

  const overrides = await getOverridesForContext({
    type: "contest",
    contestId: input.contestId,
  });

  const rows: ContestMatrixRow[] = input.participants.map((participant) => {
    const { cells, total } = buildMatrixRowCells({
      userId: participant.userId,
      problems,
      scoreIndex,
      overrides,
    });
    return {
      userId: participant.userId,
      displayName: participant.user.name,
      handle: participant.user.username ?? "",
      cells,
      total,
    };
  });

  return {
    problems,
    rows,
    totalPoints,
    studentCount: input.participants.length,
  };
}
