import { assessmentRepo, courseMembershipRepo, submissionRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";
import { problemLetter } from "../shared/problem-letter";
import {
  buildMatrixRowCells,
  type MatrixCell,
  type MatrixCellState,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";

export type { MatrixCell, MatrixCellState, MatrixProblemColumn };

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
    letter: problemLetter(p.ordinal),
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

  const scoreIndex = new Map<string, { best: number; count: number }>();
  const grouped = await submissionRepo.groupByUserAndProblem({
    courseAssessmentId: assignmentId,
    userId: { in: studentIds },
    problemId: { in: problemIds },
    sampleOnly: false,
  });
  for (const g of grouped) {
    scoreIndex.set(`${g.userId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }

  const overrides = await getOverridesForContext({
    type: "assignment",
    assignmentId,
  });

  const rows: MatrixRow[] = students.map((student) => {
    const { cells, total } = buildMatrixRowCells({
      userId: student.userId,
      problems,
      scoreIndex,
      overrides,
    });
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
