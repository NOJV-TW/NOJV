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

interface ScoreGroupRow {
  userId: string;
  _max: { score: number | null };
}

async function aggregateClassStats<G extends ScoreGroupRow>(
  rows: { id: string; courseId: string }[],
  loadScoreGroups: (ids: string[]) => Promise<G[]>,
  fk: (g: G) => string | null,
): Promise<Map<string, ClassStats>> {
  const out = new Map<string, ClassStats>();
  if (rows.length === 0) return out;

  const ids = rows.map((r) => r.id);
  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));

  const [scoreGroups, studentCountByCourse] = await Promise.all([
    loadScoreGroups(ids),
    courseMembershipRepo.countStudentsByCourse(courseIds),
  ]);

  const perTarget = new Map<string, Map<string, number>>();
  for (const g of scoreGroups) {
    const tid = fk(g);
    if (!tid) continue;
    let userTotals = perTarget.get(tid);
    if (!userTotals) {
      userTotals = new Map();
      perTarget.set(tid, userTotals);
    }
    const score = g._max.score ?? 0;
    userTotals.set(g.userId, (userTotals.get(g.userId) ?? 0) + score);
  }

  for (const row of rows) {
    const userTotals = perTarget.get(row.id) ?? new Map<string, number>();
    out.set(row.id, {
      submittedUsers: userTotals.size,
      totalStudents: studentCountByCourse.get(row.courseId) ?? 0,
      avgScore: avgScoreFromUserTotals(userTotals),
    });
  }
  return out;
}

interface AcceptedGroupRow {
  problemId: string;
}

interface MaxScoreRow {
  _max: { score: number | null };
}

interface PointSumRow {
  _sum: { points: number | null };
}

async function aggregateMyStatus<
  A extends AcceptedGroupRow,
  S extends MaxScoreRow,
  P extends PointSumRow,
>(
  rows: { id: string; problemCount: number }[],
  loaders: {
    accepted: () => Promise<A[]>;
    scores: () => Promise<S[]>;
    pointSums: () => Promise<P[]>;
  },
  fk: (g: A | S) => string | null,
  pointFk: (g: P) => string,
): Promise<Map<string, MyStatus>> {
  const out = new Map<string, MyStatus>();
  if (rows.length === 0) return out;

  const [accepted, scores, pointSums] = await Promise.all([
    loaders.accepted(),
    loaders.scores(),
    loaders.pointSums(),
  ]);

  const solvedByTarget = new Map<string, Set<string>>();
  for (const g of accepted) {
    const tid = fk(g);
    if (!tid) continue;
    let solved = solvedByTarget.get(tid);
    if (!solved) {
      solved = new Set();
      solvedByTarget.set(tid, solved);
    }
    solved.add(g.problemId);
  }

  const scoreByTarget = new Map<string, number>();
  for (const g of scores) {
    const tid = fk(g);
    if (!tid) continue;
    const score = g._max.score ?? 0;
    scoreByTarget.set(tid, (scoreByTarget.get(tid) ?? 0) + score);
  }

  const totalPointsByTarget = new Map<string, number>();
  for (const g of pointSums) {
    totalPointsByTarget.set(pointFk(g), g._sum.points ?? 0);
  }

  for (const row of rows) {
    out.set(row.id, {
      solved: solvedByTarget.get(row.id)?.size ?? 0,
      total: row.problemCount,
      score: scoreByTarget.get(row.id) ?? 0,
      totalPoints: totalPointsByTarget.get(row.id) ?? 0,
    });
  }
  return out;
}

export function aggregateAssignmentClassStats(
  rows: AssignmentRowLike[],
): Promise<Map<string, ClassStats>> {
  return aggregateClassStats(
    rows,
    (ids) => submissionRepo.groupBestScoresByAssessment(ids),
    (g) => g.assessmentId,
  );
}

export function aggregateAssignmentMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  const assignmentIds = rows.map((r) => r.id);
  return aggregateMyStatus(
    rows,
    {
      accepted: () =>
        submissionRepo.groupAcceptedByAssessmentForUser({
          assessmentIds: assignmentIds,
          userId,
        }),
      scores: () =>
        submissionRepo.groupBestScoresByAssessmentForUser({
          assessmentIds: assignmentIds,
          userId,
        }),
      pointSums: () => assessmentProblemRepo.sumPointsByAssessment(assignmentIds),
    },
    (g) => g.assessmentId,
    (g) => g.assessmentId,
  );
}

export function aggregateExamClassStats(rows: ExamRowLike[]): Promise<Map<string, ClassStats>> {
  return aggregateClassStats(
    rows,
    (ids) => submissionRepo.groupBestScoresByExam(ids),
    (g) => g.examId,
  );
}

export function aggregateExamMyStatus(
  userId: string,
  rows: { id: string; problemCount: number }[],
): Promise<Map<string, MyStatus>> {
  const examIds = rows.map((r) => r.id);
  return aggregateMyStatus(
    rows,
    {
      accepted: () => submissionRepo.groupAcceptedByExamForUser({ examIds, userId }),
      scores: () => submissionRepo.groupBestScoresByExamForUser({ examIds, userId }),
      pointSums: () => examProblemRepo.sumPointsByExam(examIds),
    },
    (g) => g.examId,
    (g) => g.examId,
  );
}
