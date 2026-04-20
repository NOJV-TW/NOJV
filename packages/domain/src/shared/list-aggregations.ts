import { courseMembershipRepo, submissionRepo } from "@nojv/db";

export interface ClassStats {
  submittedUsers: number;
  totalStudents: number;
  avgScore: number;
}

export interface MyStatus {
  solved: number;
  total: number;
}

interface AssessmentRowLike {
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

export async function aggregateAssessmentClassStats(
  rows: AssessmentRowLike[],
): Promise<Map<string, ClassStats>> {
  const out = new Map<string, ClassStats>();
  if (rows.length === 0) return out;

  const assessmentIds = rows.map((r) => r.id);
  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));

  const [scoreGroups, studentCountByCourse] = await Promise.all([
    submissionRepo.groupBestScoresByAssessment(assessmentIds),
    courseMembershipRepo.countStudentsByCourse(courseIds),
  ]);

  const perAssessment = new Map<string, Map<string, number>>();
  for (const g of scoreGroups) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    let userTotals = perAssessment.get(aid);
    if (!userTotals) {
      userTotals = new Map();
      perAssessment.set(aid, userTotals);
    }
    const score = g._max.score ?? 0;
    userTotals.set(g.userId, (userTotals.get(g.userId) ?? 0) + score);
  }

  for (const row of rows) {
    const userTotals = perAssessment.get(row.id) ?? new Map<string, number>();
    out.set(row.id, {
      submittedUsers: userTotals.size,
      totalStudents: studentCountByCourse.get(row.courseId) ?? 0,
      avgScore: avgScoreFromUserTotals(userTotals),
    });
  }
  return out;
}

export async function aggregateAssessmentMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  const out = new Map<string, MyStatus>();
  if (rows.length === 0) return out;

  const accepted = await submissionRepo.groupAcceptedByAssessmentForUser({
    assessmentIds: rows.map((r) => r.id),
    userId,
  });

  const solvedByAssessment = new Map<string, Set<string>>();
  for (const g of accepted) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    let solved = solvedByAssessment.get(aid);
    if (!solved) {
      solved = new Set();
      solvedByAssessment.set(aid, solved);
    }
    solved.add(g.problemId);
  }

  for (const row of rows) {
    out.set(row.id, {
      solved: solvedByAssessment.get(row.id)?.size ?? 0,
      total: row.problemCount,
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

  const accepted = await submissionRepo.groupAcceptedByExamForUser({
    examIds: rows.map((r) => r.id),
    userId,
  });

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

  for (const row of rows) {
    out.set(row.id, {
      solved: solvedByExam.get(row.id)?.size ?? 0,
      total: row.problemCount,
    });
  }
  return out;
}
