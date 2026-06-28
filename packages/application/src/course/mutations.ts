import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  examProblemRepo,
  examRepo,
  Prisma,
  problemRepo,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import type {
  CourseAssignmentFormData,
  CourseCreate,
  CourseUpdate,
  ManualCourseEnrollment,
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";
import { ensureUser } from "../user/mutations";
import * as notificationDomain from "../notification";
import {
  assertCourseProblemAccess,
  assertProblemHasWorkspaceForLanguages,
} from "../problem/permissions";
import { getProblemTotalScore } from "../problem/total-score";

async function assertCourseManager(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string,
) {
  if (actor.platformRole === "admin") return;

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(courseId, actor.userId);
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  if (!canManageCourse(effectiveRole) || membership?.status !== "active") {
    throw new ForbiddenError("You do not have permission to manage this course.");
  }
}

export async function createCourseRecord(actor: ActorContext, payload: CourseCreate) {
  return runTransaction(async (tx) => {
    const owner = await ensureUser(tx, actor.userId, actor);
    const course = await courseRepo.withTx(tx).create({
      description: payload.description,
      ownerId: owner.id,
      title: payload.title,
      ...(payload.academicYear != null ? { academicYear: payload.academicYear } : {}),
      ...(payload.semester != null ? { semester: payload.semester } : {}),
    });

    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: course.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id,
    });

    return { course };
  });
}

export async function manuallyEnrollCourseMember(
  actor: ActorContext,
  payload: ManualCourseEnrollment,
) {
  const { course, membership } = await runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseId);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${payload.username}`, {
      displayName: payload.displayName,
      email: payload.email,
      username: payload.username,
      platformRole: payload.role === "teacher" ? "teacher" : "student",
    });

    const membership = await courseMembershipRepo.withTx(tx).upsert(
      course.id,
      user.id,
      {
        addedByUserId: manager.id,
        courseId: course.id,
        joinedAt: new Date(),
        role: payload.role,
        status: "active",
        userId: user.id,
      },
      {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        role: payload.role,
        status: "active",
      },
    );

    return { course, membership };
  });

  if (payload.role === "student") {
    await notificationDomain.createNotification({
      userId: membership.userId,
      type: "course_enrolled",
      params: { courseId: course.id, courseName: course.title },
      linkUrl: `/courses/${course.id}`,
    });
  }

  return membership;
}

function generateAssignmentId(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Date.now().toString(36).slice(-6);
  const core = base.length > 0 ? base : "assignment";
  return `${core}-${suffix}`;
}

export async function createCourseAssignmentRecord(
  actor: ActorContext,
  courseId: string,
  payload: CourseAssignmentFormData,
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, course.id);
    const creator = await ensureUser(tx, actor.userId, actor);

    const assignmentId = generateAssignmentId(payload.title);

    if (payload.allowedLanguages.length > 0 && payload.problemIds.length > 0) {
      await Promise.all(
        payload.problemIds.map((id) =>
          assertProblemHasWorkspaceForLanguages(tx, id, payload.allowedLanguages),
        ),
      );
    }

    const adjustmentRules = payload.latePenalty ? [payload.latePenalty] : [];

    const assignment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt: new Date(payload.closesAt),
      courseId: course.id,
      createdByUserId: creator.id,
      dueAt: new Date(payload.dueAt),
      opensAt: new Date(payload.opensAt),
      id: assignmentId,
      status: payload.status,
      summary: payload.title,
      title: payload.title,
      ...(payload.maxAttemptsPerDay != null
        ? { maxAttemptsPerDay: payload.maxAttemptsPerDay }
        : {}),
      ...(payload.attemptResetMinuteOfDay != null
        ? { attemptResetMinuteOfDay: payload.attemptResetMinuteOfDay }
        : {}),
      ...(adjustmentRules.length > 0 ? { adjustmentRules: adjustmentRules } : {}),
    });

    const problemIds = payload.problemIds;
    if (problemIds.length > 0) {
      const problems = await problemRepo.withTx(tx).findMany({
        id: { in: problemIds },
      });
      const problemById = new Map(problems.map((p) => [p.id, p]));

      for (const id of problemIds) {
        const problem = problemById.get(id);
        if (!problem) {
          throw new NotFoundError(`Problem not found: ${id}`);
        }
        assertCourseProblemAccess(problem, actor);
      }

      await Promise.all(
        problemIds.map(async (id, index) => {
          const problem = problemById.get(id);
          if (!problem) throw new NotFoundError(`Problem not found: ${id}`);
          await assessmentProblemRepo.withTx(tx).create({
            assessmentId: assignment.id,
            ordinal: index + 1,
            points: await getProblemTotalScore(tx, problem),
            problemId: problem.id,
          });
        }),
      );
    }

    return assignment;
  });
}

export async function updateCourse(
  actor: ActorContext,
  courseId: string,
  payload: CourseUpdate,
) {
  return runTransaction(async (tx) => {
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).update(courseId, {
      description: payload.description,
      title: payload.title,
      academicYear: payload.academicYear ?? null,
      semester: payload.semester ?? null,
    });
  });
}

export async function deleteCourse(actor: ActorContext, courseId: string) {
  return runTransaction(async (tx) => {
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    try {
      return await courseRepo.withTx(tx).delete(courseId);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ConflictError(
          "This course has submissions and cannot be deleted. Archive it instead.",
        );
      }
      throw err;
    }
  });
}

export async function setCourseArchived(
  actor: ActorContext,
  courseId: string,
  archived: boolean,
) {
  return runTransaction(async (tx) => {
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).update(courseId, { archived });
  });
}

export async function copyCourse(
  actor: ActorContext,
  sourceCourseId: string,
  newTitle: string,
): Promise<{ newCourseId: string }> {
  const trimmedTitle = newTitle.trim();
  if (trimmedTitle.length === 0) {
    throw new ValidationError("New course title is required.");
  }
  if (trimmedTitle.length > 120) {
    throw new ValidationError("New course title must be 120 characters or fewer.");
  }

  return runTransaction(async (tx) => {
    const source = await requireCourse(tx, sourceCourseId);
    await assertCourseManager(tx, actor, source.id);

    const owner = await ensureUser(tx, actor.userId, actor);

    const newCourse = await courseRepo.withTx(tx).create({
      description: source.description,
      ownerId: owner.id,
      title: trimmedTitle,
      ...(source.academicYear != null ? { academicYear: source.academicYear } : {}),
      ...(source.semester != null ? { semester: source.semester } : {}),
    });

    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: newCourse.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id,
    });

    const sourceAssignments = await assessmentRepo
      .withTx(tx)
      .listByCourseIdAllWithProblems(source.id);

    for (const a of sourceAssignments) {
      const created = await assessmentRepo.withTx(tx).create({
        allowedLanguages: a.allowedLanguages,
        closesAt: a.closesAt,
        courseId: newCourse.id,
        createdByUserId: owner.id,
        dueAt: a.dueAt,
        opensAt: a.opensAt,
        status: "draft",
        summary: a.summary,
        title: a.title,
        ...(a.maxAttemptsPerDay != null ? { maxAttemptsPerDay: a.maxAttemptsPerDay } : {}),
        ...(a.attemptResetMinuteOfDay != null
          ? { attemptResetMinuteOfDay: a.attemptResetMinuteOfDay }
          : {}),
        ...(a.adjustmentRules != null ? { adjustmentRules: a.adjustmentRules } : {}),
      });

      for (const p of a.problems) {
        await assessmentProblemRepo.withTx(tx).create({
          assessmentId: created.id,
          ordinal: p.ordinal,
          points: p.points,
          problemId: p.problemId,
        });
      }
    }

    const sourceExams = await examRepo.withTx(tx).listByCourseIdAllWithProblems(source.id);

    for (const e of sourceExams) {
      const created = await examRepo.withTx(tx).create({
        allowedLanguages: e.allowedLanguages,
        courseId: newCourse.id,
        createdByUserId: owner.id,
        endsAt: e.endsAt,
        ipBindingEnabled: e.ipBindingEnabled,
        ipViolationMode: e.ipViolationMode,
        ipWhitelist: e.ipWhitelist,
        ipWhitelistEnabled: e.ipWhitelistEnabled,
        pageLockEnabled: e.pageLockEnabled,
        scoreboardMode: e.scoreboardMode,
        scoringMode: e.scoringMode,
        startsAt: e.startsAt,
        status: "draft",
        submitCooldownSec: e.submitCooldownSec,
        summary: e.summary,
        title: e.title,
      });

      for (const p of e.problems) {
        await examProblemRepo.withTx(tx).create({
          examId: created.id,
          ordinal: p.ordinal,
          points: p.points,
          problemId: p.problemId,
        });
      }
    }

    return { newCourseId: newCourse.id };
  });
}
