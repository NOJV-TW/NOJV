import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import {
  assignmentDomain,
  courseDomain,
  NotFoundError,
  ForbiddenError,
  resolveEffectiveCourseRole,
  canManageCourse,
} from "@nojv/application";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const { assignmentId } = event.params;

  const assignment = await assignmentDomain.getAssignmentWithCourseId(assignmentId);
  if (!assignment) {
    throw new NotFoundError("Assignment not found.");
  }

  const courseId = assignment.course.id;

  const course = await getCourseHeaderById(courseId, actor.userId);
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
    throw new NotFoundError("Assignment not found.");
  }

  if (!isManager) {
    if (assignment.status !== "published") {
      throw new NotFoundError("Assignment not found.");
    }
    const now = new Date();
    if (now > assignment.closesAt && course.archived) {
      throw new ForbiddenError("This assignment is closed.");
    }
  }

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      courseId,
      status: assignment.status,
      opensAt: assignment.opensAt.toISOString(),
      closesAt: assignment.closesAt.toISOString(),
      allowedLanguages: assignment.allowedLanguages,
      maxAttemptsPerDay: assignment.maxAttemptsPerDay,
      attemptResetMinuteOfDay: assignment.attemptResetMinuteOfDay,
    },
    course: {
      id: course.id,
      title: course.title,
      archived: course.archived,
    },
    isManager,
  };
});
