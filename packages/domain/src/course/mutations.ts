import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient
} from "@nojv/db";
import type {
  CourseAssignmentFormData,
  CourseCreate,
  CourseUpdate,
  ManualCourseEnrollment
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";
import { ensureUser } from "../user/mutations";
import {
  assertCourseProblemAccess,
  assertProblemHasWorkspaceForLanguages
} from "../problem/helpers";

/**
 * Verify that `actor` can manage `courseId`. Platform admins always pass;
 * teachers / TAs pass only when they hold an active membership on the
 * course. Throws `ForbiddenError` otherwise.
 *
 * Callers from `+page.server.ts` load bodies will already have run the
 * layout guard, but mutations need their own defensive check so that
 * form-post handlers never rely on trusted loader state.
 */
async function assertCourseManager(
  tx: TransactionClient,
  actor: ActorContext,
  courseId: string
) {
  if (actor.platformRole === "admin") return;

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(courseId, actor.userId);
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null
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
      title: payload.title
    });

    // Owner is added as a teacher. No join-token path anymore — Phase 5
    // introduces a teacher-paste handle bulk-add flow instead.
    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: course.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id
    });

    return { course };
  });
}

export async function manuallyEnrollCourseMember(
  actor: ActorContext,
  payload: ManualCourseEnrollment
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseId);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${payload.username}`, {
      displayName: payload.displayName,
      email: payload.email,
      username: payload.username,
      platformRole: payload.role === "teacher" ? "teacher" : "student"
    });

    return courseMembershipRepo.withTx(tx).upsert(
      course.id,
      user.id,
      {
        addedByUserId: manager.id,
        courseId: course.id,
        joinedAt: new Date(),
        role: payload.role,
        status: "active",
        userId: user.id
      },
      {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        role: payload.role,
        status: "active"
      }
    );
  });
}

/**
 * Deterministic, URL-safe slug derived from the title plus a short
 * timestamp suffix to avoid collisions inside the same course. The
 * (courseId, slug) composite index still enforces uniqueness — the
 * suffix just means two teachers typing the same title a minute apart
 * both succeed instead of one bouncing with a conflict.
 */
function generateAssignmentSlug(title: string): string {
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

export async function createCourseAssessmentRecord(
  actor: ActorContext,
  courseId: string,
  payload: CourseAssignmentFormData
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, course.id);
    const creator = await ensureUser(tx, actor.userId, actor);

    const slug = generateAssignmentSlug(payload.title);
    const existing = await assessmentRepo.withTx(tx).findByComposite(course.id, slug);
    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${slug}`);
    }

    // Workspace invariant: every problem must ship editable main.<ext>
    // for every language listed on the assessment. Empty list = unrestricted.
    if (payload.allowedLanguages.length > 0 && payload.problemIds.length > 0) {
      await Promise.all(
        payload.problemIds.map((id) =>
          assertProblemHasWorkspaceForLanguages(tx, id, payload.allowedLanguages)
        )
      );
    }

    // adjustmentRules is a zero-or-one array: the form carries a single
    // late-penalty choice (null | rule) and we translate to the array
    // shape the JSON column expects.
    const adjustmentRules = payload.latePenalty ? [payload.latePenalty] : [];

    const assessment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt: new Date(payload.closesAt),
      courseId: course.id,
      createdByUserId: creator.id,
      dueAt: new Date(payload.dueAt),
      opensAt: new Date(payload.opensAt),
      slug,
      status: payload.status,
      // Prototype 05 drops the summary field; use the title so the
      // DB column (non-null @db.Text) has a meaningful value.
      summary: payload.title,
      title: payload.title,
      ...(payload.maxAttemptsPerDay != null
        ? { maxAttemptsPerDay: payload.maxAttemptsPerDay }
        : {}),
      ...(adjustmentRules.length > 0
        ? { adjustmentRules: adjustmentRules as Prisma.InputJsonValue }
        : {})
    });

    const problemIds = payload.problemIds;
    if (problemIds.length > 0) {
      const problems = await problemRepo.withTx(tx).findMany({
        id: { in: problemIds }
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
            assessmentId: assessment.id,
            ordinal: index + 1,
            points: 100,
            problemId: problem.id
          });
        })
      );
    }

    return assessment;
  });
}

export async function updateCourse(
  actor: ActorContext,
  courseId: string,
  payload: CourseUpdate
) {
  return runTransaction(async (tx) => {
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).update(courseId, {
      description: payload.description,
      title: payload.title
    });
  });
}

export async function deleteCourse(actor: ActorContext, courseId: string) {
  return runTransaction(async (tx) => {
    await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, courseId);

    return courseRepo.withTx(tx).delete(courseId);
  });
}
