import {
  assessmentProblemRepo,
  assessmentRepo,
  courseJoinTokenRepo,
  courseMembershipRepo,
  courseRepo,
  problemRepo,
  runTransaction,
  type Prisma,
  type TransactionClient
} from "@nojv/db";
import type {
  CourseAssessmentCreate,
  CourseCreate,
  CourseJoinRequest,
  ManualCourseEnrollment
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { ensureUser } from "../user/mutations";
import {
  assertCourseProblemAccess,
  assertProblemHasWorkspaceForLanguages
} from "../problem/mutations";

export async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await courseRepo.withTx(tx).findBySlug(courseSlug);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  return course;
}

export async function requireCourseAssessment(
  tx: TransactionClient,
  courseSlug: string,
  assessmentSlug: string
) {
  const course = await requireCourse(tx, courseSlug);
  const assessment = await assessmentRepo.withTx(tx).findByComposite(course.id, assessmentSlug);

  if (!assessment) {
    throw new NotFoundError(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}

export async function createCourseRecord(actor: ActorContext, payload: CourseCreate) {
  return runTransaction(async (tx) => {
    const existing = await courseRepo.withTx(tx).findBySlug(payload.slug);

    if (existing) {
      throw new ConflictError(`Course slug already exists: ${payload.slug}`);
    }

    const owner = await ensureUser(tx, actor.userId, actor);
    const course = await courseRepo.withTx(tx).create({
      description: payload.description,
      locale: payload.locale,
      ownerId: owner.id,
      slug: payload.slug,
      title: payload.title,
      visibility: "invite_only"
    });

    // Owner is added as a teacher with no join token (manual add).
    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: course.id,
      joinedAt: new Date(),
      role: "teacher",
      status: "active",
      userId: owner.id
    });

    const linkToken = `${payload.slug}-link`;
    const codeToken = payload.slug.replaceAll(/-/g, "").toUpperCase().slice(0, 10);

    const joinTokens = await Promise.all([
      courseJoinTokenRepo.withTx(tx).create({
        courseId: course.id,
        createdByUserId: owner.id,
        kind: "link",
        label: "Course link",
        token: linkToken
      }),
      courseJoinTokenRepo.withTx(tx).create({
        courseId: course.id,
        createdByUserId: owner.id,
        kind: "code",
        label: "Course code",
        token: codeToken
      })
    ]);

    return {
      course,
      joinTokens
    };
  });
}

export async function joinCourseRecord(actor: ActorContext, payload: CourseJoinRequest) {
  return runTransaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const [existingMembership, joinToken] = await Promise.all([
      courseMembershipRepo.withTx(tx).findByComposite(course.id, user.id),
      courseJoinTokenRepo
        .withTx(tx)
        .findByToken(course.id, payload.joinTokenKind, payload.joinToken)
    ]);

    if (!joinToken) {
      throw new ForbiddenError("Course join token is invalid.");
    }

    if (joinToken.expiresAt && joinToken.expiresAt < new Date()) {
      throw new ForbiddenError("Course join token has expired.");
    }

    if (existingMembership?.status === "active") {
      return existingMembership;
    }

    // Atomic increment-and-check to prevent concurrent joins from over-running maxUses.
    // The Prisma `update` with `increment` is a single SQL UPDATE; if this tx later
    // throws, the increment rolls back together with the membership upsert.
    const updatedToken = await courseJoinTokenRepo.withTx(tx).incrementUsage(joinToken.id);
    if (updatedToken.maxUses !== null && updatedToken.usageCount > updatedToken.maxUses) {
      throw new ForbiddenError("Course join token has reached its maximum usage.");
    }

    const membership = await courseMembershipRepo.withTx(tx).upsert(
      course.id,
      user.id,
      {
        courseId: course.id,
        joinedAt: new Date(),
        joinedTokenId: joinToken.id,
        role: "student",
        status: "active",
        userId: user.id
      },
      {
        joinedAt: new Date(),
        joinedTokenId: joinToken.id,
        role: "student",
        status: "active"
      }
    );

    return membership;
  });
}

export async function manuallyEnrollCourseMember(
  actor: ActorContext,
  payload: ManualCourseEnrollment
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
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
        // Manual add → no join token
        joinedTokenId: null,
        role: payload.role,
        status: "active",
        userId: user.id
      },
      {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        joinedTokenId: null,
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
    const course = await requireCourse(tx, payload.courseSlug);
    const creator = await ensureUser(tx, actor.userId, actor);
    const existing = await assessmentRepo.withTx(tx).findByComposite(course.id, payload.slug);

    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${payload.slug}`);
    }

    // Workspace invariant: every problem must ship editable main.<ext>
    // for every language listed on the assessment. Empty list = unrestricted.
    if (payload.allowedLanguages.length > 0) {
      for (const id of payload.problemIds) {
        await assertProblemHasWorkspaceForLanguages(tx, id, payload.allowedLanguages);
      }
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
