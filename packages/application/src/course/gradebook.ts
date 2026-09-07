import { activityScore, sumActivityScores } from "../scoring/activity-points";
import { assessmentRepo, courseMembershipRepo, examRepo, submissionRepo } from "@nojv/db";

import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";
import { getOverridesForContext } from "../scoring/resolve-final-score";

export type GradebookContextType = "assignment" | "exam";

export interface GradebookProblemColumn {
  problemId: string;
  ordinal: number;
  title: string;
  maxScore: number;
  rawMaxScore: number;
}

export interface GradebookColumn {
  contextType: GradebookContextType;
  contextId: string;
  contextTitle: string;
  problems: GradebookProblemColumn[];
  maxTotal: number;
}

export interface GradebookRow {
  membershipId: string;
  userId: string | null;
  name: string;
  username: string | null;
  cells: Record<string, number | null>;
  total: number;
}

export interface CourseGradebook {
  columns: GradebookColumn[];
  rows: GradebookRow[];
  maxTotal: number;
}

export function gradebookCellKey(
  contextType: GradebookContextType,
  contextId: string,
  problemId: string,
): string {
  return `${contextType}:${contextId}:${problemId}`;
}

export async function buildCourseGradebook(
  courseId: string,
  options?: { forUserId?: string },
): Promise<CourseGradebook> {
  const [allStudents, assessments, exams] = await Promise.all([
    courseMembershipRepo.findStudents(courseId),
    assessmentRepo.listPublishedWithProblemsByCourse(courseId),
    examRepo.listPublishedWithProblemsByCourse(courseId),
  ]);

  const students = options?.forUserId
    ? allStudents.filter((s) => s.userId === options.forUserId)
    : allStudents;

  const contexts = [
    ...assessments.map((a) => ({
      contextType: "assignment" as const,
      contextId: a.id,
      contextTitle: a.title,
      sortAt: a.opensAt,
      deadline: a.closesAt,
      problems: a.problems,
      totalPoints: Number(a.totalPoints),
    })),
    ...exams.map((e) => ({
      contextType: "exam" as const,
      contextId: e.id,
      contextTitle: e.title,
      sortAt: e.startsAt,
      deadline: e.endsAt,
      problems: e.problems,
      totalPoints: Number(e.totalPoints),
    })),
  ].sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime());

  const allProblemIds = contexts.flatMap((c) => c.problems.map((p) => p.problem.id));
  const maxByProblem =
    allProblemIds.length > 0
      ? await getProblemTotalScores(allProblemIds)
      : new Map<string, number>();

  const columns: GradebookColumn[] = contexts.map((ctx) => {
    const problems = ctx.problems.map((p, index) => ({
      problemId: p.problem.id,
      ordinal: index + 1,
      title: p.problem.title,
      maxScore: Number(p.points),
      rawMaxScore: requireProblemTotalScore(maxByProblem, p.problem.id),
    }));
    return {
      contextType: ctx.contextType,
      contextId: ctx.contextId,
      contextTitle: ctx.contextTitle,
      problems,
      maxTotal: ctx.totalPoints,
    };
  });
  const maxTotal = columns.reduce((sum, c) => sum + c.maxTotal, 0);

  if (students.length === 0 || columns.length === 0) {
    return {
      columns,
      maxTotal,
      rows: students.map((s) => ({
        membershipId: s.id,
        userId: s.userId,
        name: s.user?.name ?? s.pendingUsername ?? "",
        username: s.user?.username ?? s.pendingUsername,
        cells: {},
        total: 0,
      })),
    };
  }

  const studentIds = students.flatMap((s) => (s.userId === null ? [] : [s.userId]));

  const perContext = await Promise.all(
    columns.map(async (column, index) => {
      const context = contexts[index];
      if (!context) throw new Error("Gradebook context missing.");
      const problemIds = column.problems.map((p) => p.problemId);
      const contextWhere =
        column.contextType === "assignment"
          ? { assessmentId: column.contextId }
          : { examId: column.contextId };
      const [grouped, overrides] = await Promise.all([
        submissionRepo.groupByUserAndProblem({
          ...contextWhere,
          userId: { in: studentIds },
          problemId: { in: problemIds },
          sampleOnly: false,
          ...(column.contextType === "exam" ? { createdAt: { lt: context.deadline } } : {}),
        }),
        getOverridesForContext(
          column.contextType === "assignment"
            ? { type: "assignment", assignmentId: column.contextId }
            : { type: "exam", examId: column.contextId },
        ),
      ]);
      const best = new Map<string, number>();
      for (const g of grouped) {
        best.set(`${g.userId}::${g.problemId}`, g._max.score ?? 0);
      }
      return { column, best, overrides };
    }),
  );

  const rows: GradebookRow[] = students.map((student) => {
    const cells: Record<string, number | null> = {};
    let total = 0;
    for (const { column, best, overrides } of perContext) {
      const contextScores: ReturnType<typeof activityScore>[] = [];
      for (const problem of column.problems) {
        const override = overrides.get(`${student.id}::${problem.problemId}`);
        const submittedScore =
          student.userId === null
            ? undefined
            : best.get(`${student.userId}::${problem.problemId}`);
        const rawScore = override ?? submittedScore ?? null;
        const score =
          rawScore === null
            ? null
            : activityScore(rawScore, problem.rawMaxScore, problem.maxScore);
        cells[gradebookCellKey(column.contextType, column.contextId, problem.problemId)] =
          score?.toNumber() ?? null;
        if (score !== null) contextScores.push(score);
      }
      total += sumActivityScores(contextScores);
    }
    return {
      membershipId: student.id,
      userId: student.userId,
      name: student.user?.name ?? student.pendingUsername ?? "",
      username: student.user?.username ?? student.pendingUsername,
      cells,
      total: sumActivityScores([total]),
    };
  });

  return { columns, rows, maxTotal };
}
