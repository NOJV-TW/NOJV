import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import {
  canManageCourse,
  courseDomain,
  resolveEffectiveCourseRole,
  NotFoundError,
  ForbiddenError,
} from "@nojv/application";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const course = await getCourseHeaderById(event.params.courseId, actor.userId);

  if (!course) {
    throw new NotFoundError("Course not found.");
  }

  const membership = course.memberships[0] ?? null;
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  const isCourseOwner = course.ownerId === actor.userId;
  const isManager = canManageCourse(effectiveRole) || isCourseOwner;

  const isEnrolled = membership?.status === "active";
  if (!isManager && !isEnrolled) {
    throw new ForbiddenError("You are not a member of this course.");
  }

  return {
    course: {
      id: course.id,
      title: course.title,
      studentCount: course._count.memberships,
      ownerDisplayName: course.owner.name,
      archived: course.archived,
    },
    isManager,
    counts: {
      assignments: course._count.assessments,
      exams: course._count.exams,
      members: course._count.memberships,
    },
  };
});
