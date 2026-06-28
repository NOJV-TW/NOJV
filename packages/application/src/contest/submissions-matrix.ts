import { submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import {
  assembleMatrix,
  type MatrixCell,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";
import type { ContestProblemSummary } from "./queries";

export interface ContestMatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: MatrixCell[];
  total: number;
}

export interface ContestSubmissionsMatrix {
  problems: MatrixProblemColumn[];
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
  const problems: MatrixProblemColumn[] = input.problems.map((p) => ({
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

  return assembleMatrix({
    problems,
    participants: input.participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.name,
      handle: p.user.username ?? "",
    })),
    scoreIndex,
    overrides,
    studentCount: input.participants.length,
  });
}
