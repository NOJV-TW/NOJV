import {
  assessmentProblemRepo,
  courseMembershipRepo,
  examProblemRepo,
  submissionRepo,
} from "@nojv/db";

export interface ClassStats {
  submittedUsers: number;
  totalStudents: number;
  avgScore: number;
}

export interface MyStatus {
  solved: number;
  total: number;
  score: number;
  totalPoints: number;
}

interface AssignmentRowLike {
  id: string;
  courseId: string;
  problemCount: number;
}

interface ExamRowLike {
  id: string;
  courseId: string;
  problemCount: number;
}

function avgScoreFromUserTotals(userTotals: Map<string, number>): number {
  if (userTotals.size === 0) return 0;
  let sum = 0;
  for (const v of userTotals.values()) sum += v;
  return Math.round(sum / userTotals.size);
}

export async function aggregateAssignmentClassStats(
  rows: AssignmentRowLike[],
): Promise<Map<string, ClassStats>> {
  const out = new Map<string, ClassStats>();
  if (rows.length === 0) return out;

  const assignmentIds = rows.map((r) => r.id);
  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));

  const [scoreGroups, studentCountByCourse] = await Promise.all([
    submissionRepo.groupBestScoresByAssessment(assignmentIds),
    courseMembershipRepo.countStudentsByCourse(courseIds),
  ]);

  const perAssignment = new Map<string, Map<string, number>>();
  for (const g of scoreGroups) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    let userTotals = perAssignment.get(aid);
    if (!userTotals) {
      userTotals = new Map();
      perAssignment.set(aid, userTotals);
    }
    const score = g._max.score ?? 0;
    userTotals.set(g.userId, (userTotals.get(g.userId) ?? 0) + score);
  }

  for (const row of rows) {
    const userTotals = perAssignment.get(row.id) ?? new Map<string, number>();
    out.set(row.id, {
      submittedUsers: userTotals.size,
      totalStudents: studentCountByCourse.get(row.courseId) ?? 0,
      avgScore: avgScoreFromUserTotals(userTotals),
    });
  }
  return out;
}

export async function aggregateAssignmentMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  const out = new Map<string, MyStatus>();
  if (rows.length === 0) return out;

  const assignmentIds = rows.map((r) => r.id);
  const [accepted, scores, pointSums] = await Promise.all([
    submissionRepo.groupAcceptedByAssessmentForUser({ assessmentIds: assignmentIds, userId }),
    submissionRepo.groupBestScoresByAssessmentForUser({ assessmentIds: assignmentIds, userId }),
    assessmentProblemRepo.sumPointsByAssessment(assignmentIds),
  ]);

  const solvedByAssignment = new Map<string, Set<string>>();
  for (const g of accepted) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    let solved = solvedByAssignment.get(aid);
    if (!solved) {
      solved = new Set();
      solvedByAssignment.set(aid, solved);
    }
    solved.add(g.problemId);
  }

  const scoreByAssignment = new Map<string, number>();
  for (const g of scores) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    const score = g._max.score ?? 0;
    scoreByAssignment.set(aid, (scoreByAssignment.get(aid) ?? 0) + score);
  }

  const totalPointsByAssignment = new Map<string, number>();
  for (const g of pointSums) {
    totalPointsByAssignment.set(g.assessmentId, g._sum.points ?? 0);
  }

  for (const row of rows) {
    out.set(row.id, {
      solved: solvedByAssignment.get(row.id)?.size ?? 0,
      total: row.problemCount,
      score: scoreByAssignment.get(row.id) ?? 0,
      totalPoints: totalPointsByAssignment.get(row.id) ?? 0,
    });
  }
  return out;
}

export async function aggregateExamClassStats(
  rows: ExamRowLike[],
): Promise<Map<string, ClassStats>> {
  const out = new Map<string, ClassStats>();
  if (rows.length === 0) return out;

  const examIds = rows.map((r) => r.id);
  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));

  const [scoreGroups, studentCountByCourse] = await Promise.all([
    submissionRepo.groupBestScoresByExam(examIds),
    courseMembershipRepo.countStudentsByCourse(courseIds),
  ]);

  const perExam = new Map<string, Map<string, number>>();
  for (const g of scoreGroups) {
    const eid = g.examId;
    if (!eid) continue;
    let userTotals = perExam.get(eid);
    if (!userTotals) {
      userTotals = new Map();
      perExam.set(eid, userTotals);
    }
    const score = g._max.score ?? 0;
    userTotals.set(g.userId, (userTotals.get(g.userId) ?? 0) + score);
  }

  for (const row of rows) {
    const userTotals = perExam.get(row.id) ?? new Map<string, number>();
    out.set(row.id, {
      submittedUsers: userTotals.size,
      totalStudents: studentCountByCourse.get(row.courseId) ?? 0,
      avgScore: avgScoreFromUserTotals(userTotals),
    });
  }
  return out;
}

export async function aggregateExamMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  const out = new Map<string, MyStatus>();
  if (rows.length === 0) return out;

  const examIds = rows.map((r) => r.id);
  const [accepted, scores, pointSums] = await Promise.all([
    submissionRepo.groupAcceptedByExamForUser({ examIds, userId }),
    submissionRepo.groupBestScoresByExamForUser({ examIds, userId }),
    examProblemRepo.sumPointsByExam(examIds),
  ]);

  const solvedByExam = new Map<string, Set<string>>();
  for (const g of accepted) {
    const eid = g.examId;
    if (!eid) continue;
    let solved = solvedByExam.get(eid);
    if (!solved) {
      solved = new Set();
      solvedByExam.set(eid, solved);
    }
    solved.add(g.problemId);
  }

  const scoreByExam = new Map<string, number>();
  for (const g of scores) {
    const eid = g.examId;
    if (!eid) continue;
    const score = g._max.score ?? 0;
    scoreByExam.set(eid, (scoreByExam.get(eid) ?? 0) + score);
  }

  const totalPointsByExam = new Map<string, number>();
  for (const g of pointSums) {
    totalPointsByExam.set(g.examId, g._sum.points ?? 0);
  }

  for (const row of rows) {
    out.set(row.id, {
      solved: solvedByExam.get(row.id)?.size ?? 0,
      total: row.problemCount,
      score: scoreByExam.get(row.id) ?? 0,
      totalPoints: totalPointsByExam.get(row.id) ?? 0,
    });
  }
  return out;
}
