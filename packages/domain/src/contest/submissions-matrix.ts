import { submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import { resolveOverridesForContext } from "../scoring/resolve-final-score";
import type { ContestProblemSummary } from "./queries";

export type ContestMatrixCellState = "ac" | "partial" | "zero" | "empty";

export interface ContestMatrixProblemColumn {
  problemId: string;
  letter: string;
  ordinal: number;
  title: string;
  points: number;
}

export interface ContestMatrixCell {
  problemId: string;
  score: number | null;
  attempts: number;
  state: ContestMatrixCellState;
}

export interface ContestMatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: ContestMatrixCell[];
  total: number;
}

export interface ContestMatrixData {
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
): Promise<ContestMatrixData> {
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

  const overrides = await resolveOverridesForContext({
    contextType: "contest",
    contextId: input.contestId,
  });

  const rows: ContestMatrixRow[] = input.participants.map((participant) => {
    const cells: ContestMatrixCell[] = problems.map((problem) => {
      const key = `${participant.userId}::${problem.problemId}`;
      const override = overrides.get(key);
      const hit = scoreIndex.get(key);
      if (override !== undefined) {
        let state: ContestMatrixCellState;
        if (override >= problem.points) state = "ac";
        else if (override > 0) state = "partial";
        else state = "zero";
        return {
          problemId: problem.problemId,
          score: override,
          attempts: hit?.count ?? 0,
          state,
        };
      }
      if (!hit || hit.count === 0) {
        return { problemId: problem.problemId, score: null, attempts: 0, state: "empty" };
      }
      let state: ContestMatrixCellState;
      if (hit.best >= problem.points) state = "ac";
      else if (hit.best > 0) state = "partial";
      else state = "zero";
      return { problemId: problem.problemId, score: hit.best, attempts: hit.count, state };
    });
    const total = cells.reduce((sum, c) => sum + (c.score ?? 0), 0);
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
