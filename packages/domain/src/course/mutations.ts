import {
  assessmentProblemRepo,
  assessmentRepo,
  courseJoinTokenRepo,
  courseMembershipRepo,
  courseProblemRepo,
  courseRepo,
  problemRepo,
  runTransaction,
  type TransactionClient
} from "@nojv/db";
import type {
  CourseAssessmentCreate,
  CourseCreate,
  CourseJoinRequest,
  CourseProblemAttach,
  ManualCourseEnrollment
} from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../shared/errors";
import { ensureUser } from "../user/mutations";
import { requireProblem, assertCourseProblemAccess } from "../problem/mutations";

/** @deprecated Use {@link ActorContext} from `../shared/actor-context` instead. */
export type CompletedActorContext = ActorContext;

// ─── Course helpers ─────────────────────────────────────────────────

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

// ─── Course mutations ───────────────────────────────────────────────

export async function createCourseRecord(actor: CompletedActorContext, payload: CourseCreate) {
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

    await courseMembershipRepo.withTx(tx).create({
      addedByUserId: owner.id,
      courseId: course.id,
      joinedAt: new Date(),
      joinedVia: "manual_invite",
      role: "teacher",
      status: "active",
      userId: owner.id
    });

    const joinCode = payload.slug.replaceAll(/-/g, "").toUpperCase().slice(0, 10);
    const qrToken = `${payload.slug}-qr`;

    const joinTokens = await Promise.all([
      courseJoinTokenRepo.withTx(tx).create({
        courseId: course.id,
        createdByUserId: owner.id,
        label: "Course code",
        method: "join_code",
        token: joinCode
      }),
      courseJoinTokenRepo.withTx(tx).create({
        courseId: course.id,
        createdByUserId: owner.id,
        label: "Course QR",
        method: "qr_code",
        token: qrToken
      })
    ]);

    return {
      course,
      joinTokens
    };
  });
}

export async function attachProblemToCourseRecord(
  actor: CompletedActorContext,
  payload: CourseProblemAttach
) {
  return runTransaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const problem = await requireProblem(tx, payload.problemSlug);
    assertCourseProblemAccess(problem, actor);

    return courseProblemRepo.withTx(tx).upsert(
      course.id,
      problem.id,
      {
        addedByUserId: user.id,
        courseId: course.id,
        problemId: problem.id
      },
      {
        addedByUserId: user.id
      }
    );
  });
}

export async function joinCourseRecord(
  actor: CompletedActorContext,
  payload: CourseJoinRequest
) {
  return runTransaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const [existingMembership, joinToken] = await Promise.all([
      courseMembershipRepo.withTx(tx).findByComposite(course.id, user.id),
      courseJoinTokenRepo.withTx(tx).findByToken(course.id, payload.joinMethod, payload.joinToken)
    ]);

    if (!joinToken) {
      throw new ForbiddenError("Course join token is invalid.");
    }

    if (joinToken.expiresAt && joinToken.expiresAt < new Date()) {
      throw new ForbiddenError("Course join token has expired.");
    }

    if (joinToken.maxUses !== null && joinToken.usageCount >= joinToken.maxUses) {
      throw new ForbiddenError("Course join token has reached its maximum usage.");
    }

    if (existingMembership?.status === "active") {
      return existingMembership;
    }

    const membership = await courseMembershipRepo.withTx(tx).upsert(
      course.id,
      user.id,
      {
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active",
        userId: user.id
      },
      {
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active"
      }
    );

    await courseJoinTokenRepo.withTx(tx).incrementUsage(joinToken.id);

    return membership;
  });
}

export async function manuallyEnrollCourseMember(
  actor: CompletedActorContext,
  payload: ManualCourseEnrollment
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${payload.username}`, {
      displayName: payload.displayName,
      email: payload.email,
      username: payload.username,
      locale: "zh-TW",
      platformRole: payload.role === "teacher" ? "teacher" : "student"
    });

    return courseMembershipRepo.withTx(tx).upsert(
      course.id,
      user.id,
      {
        addedByUserId: manager.id,
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active",
        userId: user.id
      },
      {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active"
      }
    );
  });
}

export async function createCourseAssessmentRecord(
  actor: CompletedActorContext,
  payload: CourseAssessmentCreate
) {
  return runTransaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const creator = await ensureUser(tx, actor.userId, actor);
    const existing = await assessmentRepo.withTx(tx).findByComposite(course.id, payload.slug);

    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${payload.slug}`);
    }

    const assessment = await assessmentRepo.withTx(tx).create({
      allowedLanguages: payload.allowedLanguages,
      closesAt: new Date(payload.closesAt),
      courseId: course.id,
      createdByUserId: creator.id,
      dueAt: new Date(payload.dueAt),
      ipBindingEnabled: payload.ipBindingEnabled,
      ipViolationMode: payload.ipViolationMode,
      ipWhitelist: payload.ipWhitelist,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      opensAt: new Date(payload.opensAt),
      pageLockEnabled: payload.pageLockEnabled,
      scoreboardMode: payload.scoreboardMode ?? "hidden",
      slug: payload.slug,
      status: "published",
      summary: payload.summary,
      title: payload.title
    });

    const problems = await problemRepo.withTx(tx).findMany({
      slug: { in: payload.problemSlugs }
    });
    const problemBySlug = new Map(problems.map((p) => [p.slug, p]));

    for (const slug of payload.problemSlugs) {
      const problem = problemBySlug.get(slug);
      if (!problem) {
        throw new NotFoundError(`Problem not found: ${slug}`);
      }
      assertCourseProblemAccess(problem, actor);
    }

    await Promise.all(
      payload.problemSlugs.map(async (slug, index) => {
        const problem = problemBySlug.get(slug);
        if (!problem) throw new NotFoundError(`Problem not found: ${slug}`);
        await courseProblemRepo.withTx(tx).upsert(
          course.id,
          problem.id,
          {
            addedByUserId: creator.id,
            courseId: course.id,
            problemId: problem.id
          },
          {
            addedByUserId: creator.id
          }
        );
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
