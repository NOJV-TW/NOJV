import { prisma, type TransactionClient } from "@nojv/db";
import type { CourseRole, EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import type { ActorContext } from "../actor-context";
import { requireCourse } from "../data-access/shared";

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
  actor: ActorContext
) {
  const course = await requireCourse(tx, courseSlug);
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

export async function getCoursePermissionRole(courseSlug: string, actor: ActorContext) {
  const { role } = await resolveCoursePermission(prisma, courseSlug, actor);
  return role;
}
