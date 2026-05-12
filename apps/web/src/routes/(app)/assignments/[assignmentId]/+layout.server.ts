import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import {
  assignmentDomain,
  courseDomain,
  NotFoundError,
  ForbiddenError,
  resolveEffectiveCourseRole,
  canManageCourse,
} from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const { assignmentId } = event.params;

  // Look up the assignment first — this mirrors the old `/courses/[courseId]/…`
  // tree where courseId was in the URL.  In the id-unified tree we derive it
  // from the assignment row.
  const assignment = await assignmentDomain.getAssignmentWithCourseId(assignmentId);
  if (!assignment) {
    throw new NotFoundError("Assignment not found.");
  }

  const courseId = assignment.course.id;

  // Load the course header (also enforces course visibility + fetches
  // the viewer's membership).
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
    // Mask existence for non-members.
    throw new NotFoundError("Assignment not found.");
  }

  // Time-window + draft gates (assignments use a lighter check than exam
  // proctoring — no page-lock, no IP lock, no Redis gate).  Managers
  // always see drafts/closed/upcoming so they can edit before open.
  if (!isManager) {
    if (assignment.status !== "published") {
      throw new NotFoundError("Assignment not found.");
    }
    const now = new Date();
    if (now < assignment.opensAt) {
      // Upcoming: the detail page may still render in "upcoming" mode,
      // but child problem pages are locked.  Shell stays visible so the
      // student can read the title / opens-at.
    }
    if (now > assignment.closesAt && course.archived) {
      // Archived + closed: deny click-through.  Matches the behaviour in
      // getAssignmentContext().
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
    },
    course: {
      id: course.id,
      title: course.title,
      archived: course.archived,
    },
    isManager,
  };
});
