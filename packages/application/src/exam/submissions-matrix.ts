import { courseMembershipRepo, submissionRepo } from "@nojv/db";
import { problemLetter } from "@nojv/core";

import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";
import {
  assembleMatrix,
  type MatrixCell,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";

export interface ExamMatrixRow {
  rowId: string;
  courseMembershipId: string | null;
  userId: string | null;
  displayName: string;
  handle: string;
  cells: MatrixCell[];
  total: number;
}

export interface ExamSubmissionsMatrix {
  problems: MatrixProblemColumn[];
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
  totalPoints: number;
  endsAt: Date;
  problems: ExamMatrixProblemInput[];
}

export async function buildExamSubmissionsMatrix(
  input: BuildExamMatrixInput,
): Promise<ExamSubmissionsMatrix> {
  const students = await courseMembershipRepo.findStudents(input.courseId);

  const maxByProblem = await getProblemTotalScores(input.problems.map((p) => p.problemId));
  const problems: MatrixProblemColumn[] = input.problems.map((p) => ({
    problemId: p.problemId,
    letter: problemLetter(p.ordinal),
    ordinal: p.ordinal,
    title: p.title,
    points: p.points,
    rawMaxScore: requireProblemTotalScore(maxByProblem, p.problemId),
  }));
  const totalPoints = input.totalPoints;

  if (students.length === 0 || problems.length === 0) {
    return {
      problems,
      rows: [],
      totalPoints,
      studentCount: students.length,
    };
  }

  const studentIds = students.flatMap((s) => (s.userId === null ? [] : [s.userId]));
  const membershipByUser = new Map(
    students.flatMap((s) => (s.userId === null ? [] : [[s.userId, s.id] as const])),
  );
  const problemIds = problems.map((p) => p.problemId);

  const [grouped, overrides] = await Promise.all([
    submissionRepo.groupByUserAndProblem({
      examId: input.examId,
      userId: { in: studentIds },
      problemId: { in: problemIds },
      sampleOnly: false,
      createdAt: { lt: input.endsAt },
    }),
    getOverridesForContext({ type: "exam", examId: input.examId }),
  ]);

  const scoreIndex = new Map<string, { best: number; count: number }>();
  for (const g of grouped) {
    const membershipId = membershipByUser.get(g.userId);
    if (!membershipId) continue;
    scoreIndex.set(`${membershipId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }

  return assembleMatrix({
    problems,
    totalPoints,
    participants: students.map((student) => ({
      rowId: student.id,
      courseMembershipId: student.id,
      userId: student.userId,
      displayName: student.user?.name ?? student.pendingUsername ?? "",
      handle: student.user?.username ?? student.pendingUsername ?? "",
    })),
    scoreIndex,
    overrides,
    studentCount: students.length,
  });
}
