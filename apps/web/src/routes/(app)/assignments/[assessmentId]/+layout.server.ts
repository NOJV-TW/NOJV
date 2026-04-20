import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { assessmentRepo } from "@nojv/db";
import {
  courseDomain,
  NotFoundError,
  ForbiddenError,
  resolveEffectiveCourseRole,
  canManageCourse,
} from "@nojv/domain";
import type { Language } from "@nojv/core";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const { assessmentId } = event.params;

  // Look up the assessment first — this mirrors the old `/courses/[courseId]/…`
  // tree where courseId was in the URL.  In the id-unified tree we derive it
  // from the assessment row.
  const assessment = await assessmentRepo.findByIdWithCourseId(assessmentId);
  if (!assessment) {
    throw new NotFoundError("Assignment not found.");
  }

  const courseId = assessment.course.id;

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
    if (assessment.status !== "published") {
      throw new NotFoundError("Assignment not found.");
    }
    const now = new Date();
    if (now < assessment.opensAt) {
      // Upcoming: the detail page may still render in "upcoming" mode,
      // but child problem pages are locked.  Shell stays visible so the
      // student can read the title / opens-at.
    }
    if (now > assessment.closesAt && course.archived) {
      // Archived + closed: deny click-through.  Matches the behaviour in
      // getAssessmentContext().
      throw new ForbiddenError("This assignment is closed.");
    }
  }

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      courseId,
      status: assessment.status,
      opensAt: assessment.opensAt.toISOString(),
      closesAt: assessment.closesAt.toISOString(),
      allowedLanguages: assessment.allowedLanguages as Language[],
    },
    course: {
      id: course.id,
      title: course.title,
      archived: course.archived,
    },
    isManager,
  };
});
