import {
  courseProblemRepo,
  courseRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";

import { resolveActivityProblems } from "../problem/fork";
import type { ProblemActorContext } from "../problem/permissions";
import {
  listProblemPickerGroups,
  mapProblemPickerCandidate,
  type ProblemPickerGroups,
} from "../problem/queries";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { isCourseStaffTx } from "../shared/permissions";
import { requireCourse } from "../shared/require";

async function requireLibraryCourse(
  tx: TransactionClient,
  actor: ProblemActorContext,
  courseId: string,
) {
  const course = await requireCourse(tx, courseId);
  if (actor.platformRole !== "admin" && !(await isCourseStaffTx(tx, actor.userId, courseId))) {
    throw new ForbiddenError("You do not have permission to manage this course.");
  }
  return course;
}

export async function lockCourseForStaffMutation(
  tx: TransactionClient,
  actor: ProblemActorContext,
  courseId: string,
) {
  await courseRepo.withTx(tx).lockForUpdate(courseId);
  const course = await requireLibraryCourse(tx, actor, courseId);
  if (course.archived) throw new ValidationError("Archived courses are read-only.");
  return course;
}

async function referencedProblemIds(
  tx: TransactionClient,
  courseId: string,
  problemId?: string,
) {
  const [assignments, exams] = await Promise.all([
    tx.assessment.findMany({
      where: { courseId },
      select: { id: true, detachedProblemIds: true },
    }),
    tx.exam.findMany({ where: { courseId }, select: { id: true, detachedProblemIds: true } }),
  ]);
  const assessmentId = { in: assignments.map(({ id }) => id) };
  const examId = { in: exams.map(({ id }) => id) };
  const contexts = [
    { contextType: "assignment" as const, contextId: assessmentId },
    { contextType: "exam" as const, contextId: examId },
  ];
  const [problems, scoreHistory, feedbackHistory] = await Promise.all([
    tx.problem.findMany({
      where: {
        ...(problemId === undefined ? {} : { id: problemId }),
        OR: [
          { assessmentLinks: { some: { assessment: { courseId } } } },
          { examLinks: { some: { exam: { courseId } } } },
          { submissions: { some: { OR: [{ courseId }, { assessmentId }, { examId }] } } },
          {
            submissionFeedback: {
              some: { OR: [{ membership: { courseId } }, { assessmentId }, { examId }] },
            },
          },
          { scoreOverrides: { some: { OR: [{ membership: { courseId } }, ...contexts] } } },
        ],
      },
      select: { id: true },
    }),
    tx.scoreOverrideAuditLog.findMany({
      where: { ...(problemId === undefined ? {} : { problemId }), OR: contexts },
      select: { problemId: true },
    }),
    tx.submissionFeedbackAuditLog.findMany({
      where: {
        ...(problemId === undefined ? {} : { problemId }),
        OR: [{ assessmentId }, { examId }],
      },
      select: { problemId: true },
    }),
  ]);
  return new Set([
    ...[...assignments, ...exams].flatMap(({ detachedProblemIds }) => detachedProblemIds),
    ...problems.map(({ id }) => id),
    ...scoreHistory.map(({ problemId }) => problemId),
    ...feedbackHistory.map(({ problemId }) => problemId),
  ]);
}

export async function getCourseProblemLibrary(actor: ProblemActorContext, courseId: string) {
  return runTransaction(async (tx) => {
    const course = await requireLibraryCourse(tx, actor, courseId);
    const [links, referenced] = await Promise.all([
      tx.courseProblem.findMany({
        where: { courseId },
        orderBy: [{ createdAt: "asc" }, { problemId: "asc" }],
        select: {
          problem: {
            select: {
              id: true,
              displayId: true,
              title: true,
              visibility: true,
              status: true,
              author: { select: { id: true, name: true, username: true } },
              forkedFromProblemId: true,
              assessmentLinks: {
                where: { assessment: { courseId } },
                select: { assessment: { select: { id: true, title: true } } },
              },
              examLinks: {
                where: { exam: { courseId } },
                select: { exam: { select: { id: true, title: true } } },
              },
            },
          },
        },
      }),
      referencedProblemIds(tx, courseId),
    ]);
    return {
      course: { id: course.id, title: course.title, archived: course.archived },
      problems: links.map(({ problem: { assessmentLinks, examLinks, ...problem } }) => ({
        ...problem,
        canEdit: !course.archived && problem.visibility === "private",
        canRemove: !course.archived && !referenced.has(problem.id),
        assignments: assessmentLinks.map(({ assessment }) => assessment),
        exams: examLinks.map(({ exam }) => exam),
      })),
    };
  });
}

export async function addCourseProblems(
  actor: ProblemActorContext,
  courseId: string,
  problemIds: string[],
): Promise<{ problemIds: string[] }> {
  return runTransaction(async (tx) => {
    await lockCourseForStaffMutation(tx, actor, courseId);
    const problems = await resolveActivityProblems(tx, actor, [...new Set(problemIds)], {
      courseId,
      allowDraftPrivate: true,
    });
    return { problemIds: problems.map(({ id }) => id) };
  });
}

export async function removeCourseProblem(
  actor: ProblemActorContext,
  courseId: string,
  problemId: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    await courseRepo.withTx(tx).lockForUpdate(courseId);
    const course = await requireCourse(tx, courseId);
    await tx.$queryRaw`SELECT "courseId" FROM "CourseProblem" WHERE "courseId" = ${courseId} AND "problemId" = ${problemId} FOR UPDATE`;
    const problem = await courseProblemRepo.withTx(tx).lockProblem(problemId);
    if (!problem) throw new NotFoundError(`Problem not found: ${problemId}`);
    if (
      actor.platformRole !== "admin" &&
      problem.authorId !== actor.userId &&
      !(await isCourseStaffTx(tx, actor.userId, courseId))
    ) {
      throw new ForbiddenError("You do not have permission to remove this course problem.");
    }
    if (course.archived) throw new ValidationError("Archived courses are read-only.");
    if ((await referencedProblemIds(tx, courseId, problemId)).has(problemId)) {
      throw new ConflictError(
        "This problem has course activity or history references and cannot be removed.",
      );
    }
    await courseProblemRepo.withTx(tx).remove(courseId, problemId);
  });
}

export async function listCourseProblemPickerGroups(
  actor: ProblemActorContext,
  courseId: string,
  existingProblemIds: readonly string[] = [],
): Promise<ProblemPickerGroups> {
  const courseProblems = await runTransaction(async (tx) => {
    await requireLibraryCourse(tx, actor, courseId);
    const problems = await tx.problem.findMany({
      where: {
        OR: [
          { status: "published", courseLinks: { some: { courseId } } },
          // Only server-loaded IDs from the current activity may be passed here.
          {
            id: { in: [...existingProblemIds] },
            OR: [
              { assessmentLinks: { some: { assessment: { courseId } } } },
              { examLinks: { some: { exam: { courseId } } } },
            ],
          },
        ],
      },
      orderBy: [{ displayId: "asc" }, { id: "asc" }],
    });
    return problems.map(mapProblemPickerCandidate);
  });
  return { ...(await listProblemPickerGroups(actor.userId)), courseProblems };
}
