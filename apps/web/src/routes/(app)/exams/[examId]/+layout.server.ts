import { error } from "@sveltejs/kit";
import {
  canManageCourse,
  courseDomain,
  examDomain,
  ForbiddenError,
  NotFoundError,
  proctoringDomain,
  resolveEffectiveCourseRole,
} from "@nojv/application";

import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const { examId } = event.params;

  const exam = await examDomain.getExamById(examId);
  if (!exam) {
    throw new NotFoundError("Exam not found.");
  }

  const courseId = exam.courseId;

  const course = await getCourseHeaderById(courseId, actor.userId);
  if (!course) {
    throw new NotFoundError("Exam not found.");
  }

  const membership = course.memberships[0] ?? null;
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null,
  );
  const isCourseOwner = course.ownerId === actor.userId;
  const isManager = canManageCourse(effectiveRole) || isCourseOwner;

  if (!isManager) {
    const cachedGate = event.locals.examGate;
    const verdict =
      cachedGate?.entityId === examId
        ? cachedGate.verdict
        : await proctoringDomain.checkProctoringGate({
            entityKind: "exam",
            entityId: examId,
            userId: actor.userId,
            ip: getClientIp(event),
          });

    if (!verdict.ok) {
      switch (verdict.reason) {
        case "not_found":
        case "not_published":
        case "not_enrolled":
          throw new NotFoundError("Exam not found.");
        case "course_archived":
          throw new ForbiddenError("This course has been archived.");
        case "ip_whitelist":
        case "ip_binding":
          error(403, m.examShell_ipBlocked());
          break;
        case "not_started":
        case "ended":
          break;
      }
    }
  }

  return {
    exam: {
      id: exam.id,
      courseId,
      title: exam.title,
    },
    course: {
      id: course.id,
      title: course.title,
      archived: course.archived,
    },
    isManager,
  };
});
