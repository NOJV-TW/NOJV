import { courseMembershipRepo, submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import {
  buildMatrixRowCells,
  type MatrixCell,
  type MatrixCellState,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";

export type ExamMatrixCellState = MatrixCellState;
export type ExamMatrixProblemColumn = MatrixProblemColumn;
export type ExamMatrixCell = MatrixCell;

export interface ExamMatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: ExamMatrixCell[];
  total: number;
}

export interface ExamSubmissionsMatrix {
  problems: ExamMatrixProblemColumn[];
  rows: ExamMatrixRow[];
  totalPoints: number;
  studentCount: number;
}

export interface ExamMatrixProblemInput {
  problemId: string;
  ordinal: number;
  title: string;
  points: number;
}

export interface BuildExamMatrixInput {
  examId: string;
  courseId: string;
  problems: ExamMatrixProblemInput[];
}

export async function buildExamSubmissionsMatrix(
  input: BuildExamMatrixInput,
): Promise<ExamSubmissionsMatrix> {
  const students = await courseMembershipRepo.findStudents(input.courseId);

  const problems: ExamMatrixProblemColumn[] = input.problems.map((p) => ({
    problemId: p.problemId,
    letter: problemLetter(p.ordinal),
    ordinal: p.ordinal,
    title: p.title,
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

  const [grouped, overrides] = await Promise.all([
    submissionRepo.groupByUserAndProblem({
      examId: input.examId,
      userId: { in: studentIds },
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
    getOverridesForContext({ type: "exam", examId: input.examId }),
  ]);

  const scoreIndex = new Map<string, { best: number; count: number }>();
  for (const g of grouped) {
    scoreIndex.set(`${g.userId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }

  const rows: ExamMatrixRow[] = students.map((student) => {
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
