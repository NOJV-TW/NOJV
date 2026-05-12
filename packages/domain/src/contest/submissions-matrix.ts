import { contestRepo, contestParticipationRepo, submissionRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";
import { resolveOverridesForContext } from "../scoring/resolve-final-score";

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

function letterFor(ordinal: number): string {
  if (ordinal < 1) return String(ordinal);
  let n = ordinal;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

// Does not re-check permissions; route loader must gate on `isManager` before calling.
export async function getContestSubmissionsMatrix(
  contestId: string,
): Promise<ContestMatrixData> {
  const contest = await contestRepo.findDetailById(contestId);
  if (!contest) throw new NotFoundError("Contest not found.");

  const participants = await contestParticipationRepo.listParticipantsWithUser(contestId);

  const problems: ContestMatrixProblemColumn[] = contest.problems.map((p) => ({
    problemId: p.problem.id,
    letter: letterFor(p.ordinal),
    ordinal: p.ordinal,
    title: p.problem.title,
    points: p.points,
  }));
  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  if (participants.length === 0 || problems.length === 0) {
    return {
      problems,
      rows: [],
      totalPoints,
      studentCount: participants.length,
    };
  }

  const userIds = participants.map((p) => p.userId);
  const problemIds = problems.map((p) => p.problemId);

  const grouped = await submissionRepo.groupByUserAndProblem({
    contestId,
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
    contextId: contestId,
  });

  const rows: ContestMatrixRow[] = participants.map((participant) => {
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
    studentCount: participants.length,
  };
}
