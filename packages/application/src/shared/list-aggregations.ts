import {
  assessmentProblemRepo,
  courseMembershipRepo,
  examProblemRepo,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";

import { getProblemTotalScores } from "../problem/total-score";

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
  problemId: string;
  userId: string;
  _max: { score: number | null };
}

async function aggregateClassStats<G extends ScoreGroupRow>(
  rows: { id: string; courseId: string }[],
  loadScoreGroups: (ids: string[]) => Promise<G[]>,
  fk: (g: G) => string | null,
  contextType: "assignment" | "exam",
): Promise<Map<string, ClassStats>> {
  const out = new Map<string, ClassStats>();
  if (rows.length === 0) return out;

  const ids = rows.map((r) => r.id);
  const courseIds = Array.from(new Set(rows.map((r) => r.courseId)));

  const [scoreGroups, studentCountByCourse, overrides] = await Promise.all([
    loadScoreGroups(ids),
    courseMembershipRepo.countStudentsByCourse(courseIds),
    scoreOverrideRepo.findCourseOverrides(contextType, ids),
  ]);

  const perTarget = new Map<string, Map<string, Map<string, number>>>();
  function setScore(targetId: string, rowId: string, problemId: string, score: number) {
    let target = perTarget.get(targetId);
    if (!target) perTarget.set(targetId, (target = new Map<string, Map<string, number>>()));
    let scores = target.get(rowId);
    if (!scores) target.set(rowId, (scores = new Map<string, number>()));
    scores.set(problemId, score);
  }
  for (const g of scoreGroups) {
    const targetId = fk(g);
    if (targetId) setScore(targetId, g.userId, g.problemId, g._max.score ?? 0);
  }
  const submittedByTarget = new Map([...perTarget].map(([id, rows]) => [id, rows.size]));
  for (const override of overrides) {
    const rowId = override.membership?.userId ?? override.courseMembershipId;
    if (rowId !== null)
      setScore(override.contextId, rowId, override.problemId, override.overrideScore);
  }
  for (const row of rows) {
    const totals = new Map<string, number>();
    for (const [rowId, scores] of perTarget.get(row.id) ?? []) {
      totals.set(
        rowId,
        [...scores.values()].reduce((sum, score) => sum + score, 0),
      );
    }
    out.set(row.id, {
      submittedUsers: submittedByTarget.get(row.id) ?? 0,
      totalStudents: studentCountByCourse.get(row.courseId) ?? 0,
      avgScore: avgScoreFromUserTotals(totals),
    });
  }
  return out;
}

interface AcceptedGroupRow {
  problemId: string;
}

interface MaxScoreRow {
  problemId: string;
  _max: { score: number | null };
}

async function liveTotalPointsByTarget(
  links: { targetId: string; problemId: string }[],
): Promise<Map<string, number>> {
  const maxByProblem = await getProblemTotalScores(links.map((l) => l.problemId));
  const out = new Map<string, number>();
  for (const l of links) {
    out.set(l.targetId, (out.get(l.targetId) ?? 0) + (maxByProblem.get(l.problemId) ?? 0));
  }
  return out;
}

async function aggregateMyStatus<A extends AcceptedGroupRow, S extends MaxScoreRow>(
  rows: { id: string; problemCount: number }[],
  loaders: {
    accepted: () => Promise<A[]>;
    scores: () => Promise<S[]>;
    overrides: () => ReturnType<typeof scoreOverrideRepo.findCourseOverrides>;
    totalPoints: () => Promise<Map<string, number>>;
  },
  fk: (g: A | S) => string | null,
): Promise<Map<string, MyStatus>> {
  const out = new Map<string, MyStatus>();
  if (rows.length === 0) return out;

  const [accepted, scores, totalPointsByTarget, overrides] = await Promise.all([
    loaders.accepted(),
    loaders.scores(),
    loaders.totalPoints(),
    loaders.overrides(),
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
  const scoresByProblem = new Map<string, number>();
  for (const g of scores) {
    const tid = fk(g);
    if (!tid) continue;
    const score = g._max.score ?? 0;
    scoresByProblem.set(`${tid}::${g.problemId}`, score);
    scoreByTarget.set(tid, (scoreByTarget.get(tid) ?? 0) + score);
  }

  for (const override of overrides) {
    const oldScore = scoresByProblem.get(`${override.contextId}::${override.problemId}`) ?? 0;
    scoreByTarget.set(
      override.contextId,
      (scoreByTarget.get(override.contextId) ?? 0) - oldScore + override.overrideScore,
    );
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
    "assignment",
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
      overrides: () =>
        scoreOverrideRepo.findCourseOverrides("assignment", assignmentIds, userId),
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
      totalPoints: async () => {
        const links = await assessmentProblemRepo.listProblemLinks(assignmentIds);
        return liveTotalPointsByTarget(
          links.map((l) => ({ targetId: l.assessmentId, problemId: l.problemId })),
        );
      },
    },
    (g) => g.assessmentId,
  );
}

export function aggregateExamClassStats(rows: ExamRowLike[]): Promise<Map<string, ClassStats>> {
  return aggregateClassStats(
    rows,
    (ids) => submissionRepo.groupBestScoresByExam(ids),
    (g) => g.examId,
    "exam",
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
      overrides: () => scoreOverrideRepo.findCourseOverrides("exam", examIds, userId),
      accepted: () => submissionRepo.groupAcceptedByExamForUser({ examIds, userId }),
      scores: () => submissionRepo.groupBestScoresByExamForUser({ examIds, userId }),
      totalPoints: async () => {
        const links = await examProblemRepo.listProblemLinks(examIds);
        return liveTotalPointsByTarget(
          links.map((l) => ({ targetId: l.examId, problemId: l.problemId })),
        );
      },
    },
    (g) => g.examId,
  );
}
