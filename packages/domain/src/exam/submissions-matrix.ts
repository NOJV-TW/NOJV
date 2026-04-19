import { courseMembershipRepo, examRepo, submissionRepo } from "@nojv/db";

import { NotFoundError } from "../shared/errors";

export type ExamMatrixCellState = "ac" | "partial" | "zero" | "empty";

export interface ExamMatrixProblemColumn {
  problemId: string;
  letter: string;
  ordinal: number;
  title: string;
  points: number;
}

export interface ExamMatrixCell {
  problemId: string;
  score: number | null;
  attempts: number;
  state: ExamMatrixCellState;
}

export interface ExamMatrixRow {
  userId: string;
  displayName: string;
  handle: string;
  cells: ExamMatrixCell[];
  total: number;
}

export interface ExamMatrixData {
  problems: ExamMatrixProblemColumn[];
  rows: ExamMatrixRow[];
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
export async function getExamSubmissionsMatrix(examId: string): Promise<ExamMatrixData> {
  const exam = await examRepo.findDetailById(examId);
  if (!exam) throw new NotFoundError("Exam not found.");

  const students = await courseMembershipRepo.findStudents(exam.courseId);

  const problems: ExamMatrixProblemColumn[] = exam.problems.map((p) => ({
    problemId: p.problem.id,
    letter: letterFor(p.ordinal),
    ordinal: p.ordinal,
    title: p.problem.title,
    points: p.points
  }));
  const totalPoints = problems.reduce((sum, p) => sum + p.points, 0);

  if (students.length === 0 || problems.length === 0) {
    return {
      problems,
      rows: [],
      totalPoints,
      studentCount: students.length
    };
  }

  const studentIds = students.map((s) => s.userId);
  const problemIds = problems.map((p) => p.problemId);

  // `groupByUserAndProblem` gives both best score AND attempt count in one
  // pass; the assignment variant also calls `groupBestScores` first but then
  // discards it. Skip that dead call — one query is enough.
  const grouped = await submissionRepo.groupByUserAndProblem({
    examId,
    userId: { in: studentIds },
    problemId: { in: problemIds },
    sampleOnly: false
  });

  const scoreIndex = new Map<string, { best: number; count: number }>();
  for (const g of grouped) {
    scoreIndex.set(`${g.userId}::${g.problemId}`, {
      best: g._max.score ?? 0,
      count: g._count.id
    });
  }

  const rows: ExamMatrixRow[] = students.map((student) => {
    const cells: ExamMatrixCell[] = problems.map((problem) => {
      const key = `${student.userId}::${problem.problemId}`;
      const hit = scoreIndex.get(key);
      if (!hit || hit.count === 0) {
        return { problemId: problem.problemId, score: null, attempts: 0, state: "empty" };
      }
      let state: ExamMatrixCellState;
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
      total
    };
  });

  return {
    problems,
    rows,
    totalPoints,
    studentCount: students.length
  };
}
