import { prisma, type TransactionClient } from "@nojv/db";
import type {
  CourseAssessmentCreate,
  CourseCreate,
  CourseJoinRequest,
  CourseProblemAttach,
  ManualCourseEnrollment
} from "@nojv/core";

import type { CompletedActorContext } from "../auth";
import { ConflictError, ForbiddenError, NotFoundError } from "../auth";
import { ensureUser } from "../user/mutations";
import { assertCourseProblemAccess, requireProblem } from "../problem/mutations";

// --- Course helpers ---

export async function requireCourse(tx: TransactionClient, courseSlug: string) {
  const course = await tx.course.findUnique({
    where: {
      slug: courseSlug
    }
  });

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
  const assessment = await tx.courseAssessment.findUnique({
    where: {
      courseId_slug: {
        courseId: course.id,
        slug: assessmentSlug
      }
    }
  });

  if (!assessment) {
    throw new NotFoundError(`Assessment not found: ${courseSlug}/${assessmentSlug}`);
  }

  return {
    assessment,
    course
  };
}

// --- Course mutations ---

export async function createCourseRecord(actor: CompletedActorContext, payload: CourseCreate) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.course.findUnique({
      where: {
        slug: payload.slug
      }
    });

    if (existing) {
      throw new ConflictError(`Course slug already exists: ${payload.slug}`);
    }

    const owner = await ensureUser(tx, actor.userId, actor);
    const course = await tx.course.create({
      data: {
        description: payload.description,
        locale: payload.locale,
        ownerId: owner.id,
        slug: payload.slug,
        title: payload.title,
        visibility: "invite_only"
      }
    });

    await tx.courseMembership.create({
      data: {
        addedByUserId: owner.id,
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: "teacher",
        status: "active",
        userId: owner.id
      }
    });

    const joinCode = payload.slug.replaceAll(/-/g, "").toUpperCase().slice(0, 10);
    const qrToken = `${payload.slug}-qr`;

    const joinTokens = await Promise.all([
      tx.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: owner.id,
          label: "Course code",
          method: "join_code",
          token: joinCode
        }
      }),
      tx.courseJoinToken.create({
        data: {
          courseId: course.id,
          createdByUserId: owner.id,
          label: "Course QR",
          method: "qr_code",
          token: qrToken
        }
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
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const problem = await requireProblem(tx, payload.problemSlug);
    assertCourseProblemAccess(problem, actor);

    return tx.courseProblem.upsert({
      create: {
        addedByUserId: user.id,
        courseId: course.id,
        problemId: problem.id
      },
      update: {
        addedByUserId: user.id
      },
      where: {
        courseId_problemId: {
          courseId: course.id,
          problemId: problem.id
        }
      }
    });
  });
}

export async function joinCourseRecord(
  actor: CompletedActorContext,
  payload: CourseJoinRequest
) {
  return prisma.$transaction(async (tx) => {
    const user = await ensureUser(tx, actor.userId, actor);
    const course = await requireCourse(tx, payload.courseSlug);
    const [existingMembership, joinToken] = await Promise.all([
      tx.courseMembership.findUnique({
        where: {
          courseId_userId: {
            courseId: course.id,
            userId: user.id
          }
        }
      }),
      tx.courseJoinToken.findFirst({
        where: {
          courseId: course.id,
          method: payload.joinMethod,
          token: payload.joinToken
        }
      })
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

    const membership = await tx.courseMembership.upsert({
      create: {
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active",
        userId: user.id
      },
      update: {
        joinedAt: new Date(),
        joinedVia: payload.joinMethod,
        role: "student",
        status: "active"
      },
      where: {
        courseId_userId: {
          courseId: course.id,
          userId: user.id
        }
      }
    });

    await tx.courseJoinToken.update({
      data: {
        usageCount: {
          increment: 1
        }
      },
      where: {
        id: joinToken.id
      }
    });

    return membership;
  });
}

export async function manuallyEnrollCourseMember(
  actor: CompletedActorContext,
  payload: ManualCourseEnrollment
) {
  return prisma.$transaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const manager = await ensureUser(tx, actor.userId, actor);
    const user = await ensureUser(tx, `usr_${payload.username}`, {
      displayName: payload.displayName,
      email: payload.email,
      username: payload.username,
      locale: "zh-TW",
      platformRole: payload.role === "teacher" ? "teacher" : "student"
    });

    return tx.courseMembership.upsert({
      create: {
        addedByUserId: manager.id,
        courseId: course.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active",
        userId: user.id
      },
      update: {
        addedByUserId: manager.id,
        joinedAt: new Date(),
        joinedVia: "manual_invite",
        role: payload.role,
        status: "active"
      },
      where: {
        courseId_userId: {
          courseId: course.id,
          userId: user.id
        }
      }
    });
  });
}

export async function createCourseAssessmentRecord(
  actor: CompletedActorContext,
  payload: CourseAssessmentCreate
) {
  return prisma.$transaction(async (tx) => {
    const course = await requireCourse(tx, payload.courseSlug);
    const creator = await ensureUser(tx, actor.userId, actor);
    const existing = await tx.courseAssessment.findUnique({
      where: {
        courseId_slug: {
          courseId: course.id,
          slug: payload.slug
        }
      }
    });

    if (existing) {
      throw new ConflictError(`Assessment slug already exists in course: ${payload.slug}`);
    }

    const assessment = await tx.courseAssessment.create({
      data: {
        closesAt: new Date(payload.closesAt),
        courseId: course.id,
        createdByUserId: creator.id,
        dueAt: new Date(payload.dueAt),
        ipLockEnabled: payload.ipLockEnabled,
        opensAt: new Date(payload.opensAt),
        pageLockEnabled: payload.pageLockEnabled,
        scoreboardMode: payload.scoreboardMode ?? (payload.type === "exam" ? "live" : "hidden"),
        slug: payload.slug,
        status: "published",
        summary: payload.summary,
        title: payload.title,
        type: payload.type
      }
    });

    const problems = await tx.problem.findMany({
      where: { slug: { in: payload.problemSlugs } }
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
        await tx.courseProblem.upsert({
          create: {
            addedByUserId: creator.id,
            courseId: course.id,
            problemId: problem.id
          },
          update: {
            addedByUserId: creator.id
          },
          where: {
            courseId_problemId: {
              courseId: course.id,
              problemId: problem.id
            }
          }
        });
        await tx.courseAssessmentProblem.create({
          data: {
            assessmentId: assessment.id,
            ordinal: index + 1,
            points: 100,
            problemId: problem.id
          }
        });
      })
    );

    return assessment;
  });
}
