import { assessmentRepo, courseMembershipRepo, submissionRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";
import { resolveOverridesForContext } from "../scoring/resolve-final-score";

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
}

export interface MatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: MatrixCell[];
  total: number;
}

export interface SubmissionsMatrix {
  problems: MatrixProblemColumn[];
  rows: MatrixRow[];
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
export async function buildSubmissionsMatrix(
  courseId: string,
  assignmentId: string,
): Promise<SubmissionsMatrix> {
  const [assignment, students] = await Promise.all([
    assessmentRepo.findDetailById(courseId, assignmentId),
    courseMembershipRepo.findStudents(courseId),
  ]);
  if (!assignment) throw new NotFoundError("Assignment not found.");

  const problems: MatrixProblemColumn[] = assignment.problems.map((p) => ({
    problemId: p.problem.id,
    letter: letterFor(p.ordinal),
    ordinal: p.ordinal,
    title: p.problem.title,
    points: p.points,
  }));
  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  if (students.length === 0 || problems.length === 0) {
    return {
      problems,
      rows: [],
      totalPoints,
      studentCount: students.length,
    };
  }

  const studentIds = students.map((s) => s.userId);
  const problemIds = problems.map((p) => p.problemId);

  const grouped = await submissionRepo.groupBestScores({
    assessmentId: assignmentId,
    studentIds,
    problemIds,
  });

  const scoreIndex = new Map<string, { best: number; count: number }>();
  // `groupBestScores` only returns `_max.score`; the second call also folds in attempt counts.
  const fullGrouped = await submissionRepo.groupByUserAndProblem({
    courseAssessmentId: assignmentId,
    userId: { in: studentIds },
    problemId: { in: problemIds },
    sampleOnly: false,
  });
  for (const g of fullGrouped) {
    scoreIndex.set(`${g.userId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }
  void grouped;

  // Overlay any manual score overrides. Overrides win over the best-submission
  // score and also "unlock" a cell that otherwise had 0 attempts — a teacher
  // can assign credit for an off-platform solution.
  const overrides = await resolveOverridesForContext({
    type: "assignment",
    assignmentId,
  });

  const rows: MatrixRow[] = students.map((student) => {
    const cells: MatrixCell[] = problems.map((problem) => {
      const key = `${student.userId}::${problem.problemId}`;
      const override = overrides.get(key);
      const hit = scoreIndex.get(key);
      if (override !== undefined) {
        let state: MatrixCellState;
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
      let state: MatrixCellState;
      if (hit.best >= problem.points) state = "ac";
      else if (hit.best > 0) state = "partial";
      else state = "zero";
      return { problemId: problem.problemId, score: hit.best, attempts: hit.count, state };
    });
    const total = cells.reduce((sum, c) => sum + (c.score ?? 0), 0);
    return {
      userId: student.userId,
      displayName: student.user.name,
      handle: student.user.username ?? "",
      cells,
      total,
    };
  });

  return {
    problems,
    rows,
    totalPoints,
    studentCount: students.length,
  };
}
