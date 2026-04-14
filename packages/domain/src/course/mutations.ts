import {
  assessmentProblemRepo,
  assessmentRepo,
  courseMembershipRepo,
  courseRepo,
  problemRepo,
  runTransaction,
  type Prisma
} from "@nojv/db";
import type { CourseAssessmentCreate, CourseCreate, ManualCourseEnrollment } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, NotFoundError } from "../shared/errors";
import { requireCourse } from "../shared/require";
import { ensureUser } from "../user/mutations";
import {
  assertCourseProblemAccess,
  assertProblemHasWorkspaceForLanguages
} from "../problem/helpers";

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

export async function createCourseAssessmentRecord(
  actor: ActorContext,
  payload: CourseAssessmentCreate
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseId);
    const creator = await ensureUser(tx, actor.userId, actor);
    const existing = await assessmentRepo.withTx(tx).findByComposite(course.id, payload.slug);

    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${payload.slug}`);
    }

    // Workspace invariant: every problem must ship editable main.<ext>
    // for every language listed on the assessment. Empty list = unrestricted.
    if (payload.allowedLanguages.length > 0) {
      await Promise.all(
        payload.problemIds.map((id) =>
          assertProblemHasWorkspaceForLanguages(tx, id, payload.allowedLanguages)
        )
      );
    }

    const assessment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt: new Date(payload.closesAt),
      courseId: course.id,
      createdByUserId: creator.id,
      // dueAt is now optional on the schema. The form may omit it.
      ...(payload.dueAt ? { dueAt: new Date(payload.dueAt) } : {}),
      opensAt: new Date(payload.opensAt),
      slug: payload.slug,
      status: "published",
      summary: payload.summary,
      title: payload.title,
      ...(payload.adjustmentRules
        ? { adjustmentRules: payload.adjustmentRules as Prisma.InputJsonValue }
        : {})
    });

    const problemIds = payload.problemIds;
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

    return assessment;
  });
}
