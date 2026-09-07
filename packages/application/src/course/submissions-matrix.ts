import { assessmentRepo, courseMembershipRepo, submissionRepo } from "@nojv/db";
import { problemLetter } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getProblemTotalScores } from "../problem/total-score";
import {
  assembleMatrix,
  type MatrixCell,
  type MatrixProblemColumn,
} from "../shared/submissions-matrix";
import { getOverridesForContext } from "../scoring/resolve-final-score";

export type { MatrixCellState } from "../shared/submissions-matrix";
export type { MatrixCell, MatrixProblemColumn };

export interface MatrixRow {
  rowId: string;
  courseMembershipId: string | null;
  userId: string | null;
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

export interface BuildSubmissionsMatrixOptions {
  now?: Date;
}

export async function buildSubmissionsMatrix(
  courseId: string,
  assignmentId: string,
  options: BuildSubmissionsMatrixOptions = {},
): Promise<SubmissionsMatrix> {
  const [assignment, students] = await Promise.all([
    assessmentRepo.findDetailById(courseId, assignmentId),
    courseMembershipRepo.findStudents(courseId),
  ]);
  if (!assignment) throw new NotFoundError("Assignment not found.");

  const maxByProblem = await getProblemTotalScores(
    assignment.problems.map((p) => p.problem.id),
  );
  const problems: MatrixProblemColumn[] = assignment.problems.map((p) => ({
    problemId: p.problem.id,
    letter: problemLetter(p.ordinal),
    ordinal: p.ordinal,
    title: p.problem.title,
    points: maxByProblem.get(p.problem.id) ?? p.points,
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

  const studentIds = students.flatMap((s) => (s.userId === null ? [] : [s.userId]));
  const membershipByUser = new Map(
    students.flatMap((s) => (s.userId === null ? [] : [[s.userId, s.id] as const])),
  );
  const problemIds = problems.map((p) => p.problemId);
  const closed = assignment.closesAt < (options.now ?? new Date());

  const scoreIndex = new Map<string, { best: number; count: number }>();
  const practiceIndex = new Map<string, { best: number; count: number }>();
  const [grouped, practiceGrouped] = await Promise.all([
    submissionRepo.groupByUserAndProblem({
      assessmentId: assignmentId,
      userId: { in: studentIds },
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
    closed
      ? submissionRepo.groupByUserAndProblem({
          assessmentId: null,
          contestId: null,
          courseId: null,
          examId: null,
          participationId: null,
          userId: { in: studentIds },
          problemId: { in: problemIds },
          sampleOnly: false,
          createdAt: { gt: assignment.closesAt },
        })
      : Promise.resolve([]),
  ]);
  for (const g of grouped) {
    const membershipId = membershipByUser.get(g.userId);
    if (!membershipId) continue;
    scoreIndex.set(`${membershipId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }
  for (const g of practiceGrouped) {
    const membershipId = membershipByUser.get(g.userId);
    if (!membershipId) continue;
    practiceIndex.set(`${membershipId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id,
    });
  }

  const overrides = await getOverridesForContext({
    type: "assignment",
    assignmentId,
  });

  return assembleMatrix({
    problems,
    participants: students.map((student) => ({
      rowId: student.id,
      courseMembershipId: student.id,
      userId: student.userId,
      displayName: student.user?.name ?? student.pendingUsername ?? "",
      handle: student.user?.username ?? student.pendingUsername ?? "",
    })),
    scoreIndex,
    overrides,
    practiceIndex,
    studentCount: students.length,
  });
}
