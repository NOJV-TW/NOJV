import { prisma, type TransactionClient } from "@nojv/db";
import type { CourseRole, EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import type { PocActorContext } from "../actor-context";
import { NotFoundError } from "../api-errors";

export function resolveCoursePermissionRole(input: {
  courseRole?: CourseRole | null;
  platformRole: PlatformRole;
}): EffectiveCourseRole | null {
  if (input.platformRole === "admin") {
    return "admin";
  }

  return input.courseRole ?? null;
}

export async function resolveCoursePermission(
  tx: TransactionClient,
  courseSlug: string,
  actor: PocActorContext
) {
  const course = await tx.course.findUnique({
    where: { slug: courseSlug }
  });

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  const membership = await tx.courseMembership.findUnique({
    where: {
      courseId_userId: {
        courseId: course.id,
        userId: actor.userId
      }
    }
  });

  return {
    course,
    role: resolveCoursePermissionRole({
      courseRole: membership?.role ?? null,
      platformRole: actor.platformRole
    })
  };
}

export async function getCoursePermissionRole(courseSlug: string, actor: PocActorContext) {
  return prisma.$transaction(async (tx) => {
    const { role } = await resolveCoursePermission(tx, courseSlug, actor);
    return role;
  });
}
