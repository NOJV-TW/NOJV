import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  examProblemRepo,
  examRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import type {
  CourseAssignmentFormData,
  CourseCreate,
  CourseUpdate,
  ManualCourseEnrollment,
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { canManageCourse, resolveEffectiveCourseRole } from "../shared/permissions";
import { requireCourse } from "../shared/require";
import { ensureUser } from "../user/mutations";
import * as notificationDomain from "../notification";
import {
  assertCourseProblemAccess,
  assertProblemHasWorkspaceForLanguages,
} from "../problem/helpers";

// Defensive re-check so form-post handlers never rely on trusted loader state.
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
    });

    // Owner is added as a teacher. No join-token path anymore — Phase 5
    // introduces a teacher-paste handle bulk-add flow instead.
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

  // Only students get a participant-style notification. Teachers / TAs are
  // staff and get their context from the course manage UI, not the bell.
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

// Suffix makes the readable id collision-resistant when two teachers type the same title.
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

export async function createCourseAssessmentRecord(
  actor: ActorContext,
  courseId: string,
  payload: CourseAssignmentFormData,
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, courseId);
    await assertCourseManager(tx, actor, course.id);
    const creator = await ensureUser(tx, actor.userId, actor);

    const assessmentId = generateAssignmentId(payload.title);

    // Workspace invariant: every problem must ship editable main.<ext>
    // for every language listed on the assessment. Empty list = unrestricted.
    if (payload.allowedLanguages.length > 0 && payload.problemIds.length > 0) {
      await Promise.all(
        payload.problemIds.map((id) =>
          assertProblemHasWorkspaceForLanguages(tx, id, payload.allowedLanguages),
        ),
      );
    }

    const adjustmentRules = payload.latePenalty ? [payload.latePenalty] : [];

    const assessment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt: new Date(payload.closesAt),
      courseId: course.id,
      createdByUserId: creator.id,
      dueAt: new Date(payload.dueAt),
      opensAt: new Date(payload.opensAt),
      id: assessmentId,
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
        : {}),
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
            assessmentId: assessment.id,
            ordinal: index + 1,
            points: 100,
            problemId: problem.id,
          });
        }),
      );
    }

    return assessment;
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

// Course managers flip `archived` to freeze student click-through while
// preserving their score history. The action is reversible; destructive
// ops live in deleteCourse. No read-side invalidation needed — every
// consumer reads `course.archived` fresh via the layout loader.
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

/**
 * Duplicate a course's structural scaffolding into a brand-new course.
 *
 * Copied: course title/description, all assessments (all statuses, reset
 * to `draft`) and their problem attachments, all exams (all statuses,
 * reset to `draft`) and their problem attachments.
 *
 * Intentionally NOT copied: memberships (actor becomes the sole teacher),
 * submissions, participations, exam sessions, announcements, plagiarism
 * reports, IP violation logs. These are either historical data tied to
 * the source term or time-bound artefacts that the new course will grow
 * on its own.
 *
 * Returns the new course id so the caller can redirect to its settings.
 */
export async function copyCourse(
  actor: ActorContext,
  sourceCourseId: string,
): Promise<{ newCourseId: string }> {
  return runTransaction(async (tx) => {
    const source = await requireCourse(tx, sourceCourseId);
    await assertCourseManager(tx, actor, source.id);

    const owner = await ensureUser(tx, actor.userId, actor);

    // 1. New Course (title suffixed, archived reset, new owner = actor).
    const newCourse = await courseRepo.withTx(tx).create({
      description: source.description,
      ownerId: owner.id,
      title: `${source.title} (copy)`,
    });

    // 2. Actor becomes the teacher of the new course. Other roster members
    // are NOT carried over; the new course starts with a clean member list.
    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: newCourse.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id,
    });

    // 3. Clone assessments — status reset to draft so nothing auto-publishes.
    const sourceAssessments = await assessmentRepo
      .withTx(tx)
      .listByCourseIdAllWithProblems(source.id);

    for (const a of sourceAssessments) {
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
        ...(a.adjustmentRules != null
          ? { adjustmentRules: a.adjustmentRules as Prisma.InputJsonValue }
          : {}),
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

    // 4. Clone exams — status reset to draft; proctoring config carries over.
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
