import { error } from "@sveltejs/kit";
import { examRepo } from "@nojv/db";
import {
  canManageCourse,
  courseDomain,
  ForbiddenError,
  NotFoundError,
  proctoringDomain,
  resolveEffectiveCourseRole
} from "@nojv/domain";

import type { LayoutServerLoad, LayoutServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getCourseHeaderById } = courseDomain;

export const load: LayoutServerLoad = handleLoad(async (event: LayoutServerLoadEvent) => {
  const actor = requireAuth(event);
  const { examId } = event.params;

  // Look up the exam first so we can derive the courseId — same approach
  // as the id-unified assignment shell.
  const exam = await examRepo.findById(examId);
  if (!exam) {
    throw new NotFoundError("Exam not found.");
  }

  const courseId = exam.courseId;

  const course = await getCourseHeaderById(courseId, actor.userId);
  if (!course) {
    // Course gone under the exam — mask as exam-level 404.
    throw new NotFoundError("Exam not found.");
  }

  const membership = course.memberships[0] ?? null;
  const effectiveRole = resolveEffectiveCourseRole(
    actor.platformRole,
    membership?.role ?? null
  );
  const isCourseOwner = course.ownerId === actor.userId;
  const isManager = canManageCourse(effectiveRole) || isCourseOwner;

  // Managers bypass the proctoring gate — they always get the detail
  // view so they can author / preview before the exam opens.
  if (!isManager) {
    const verdict = await proctoringDomain.checkProctoringGate({
      entityKind: "exam",
      entityId: examId,
      userId: actor.userId,
      ip: getClientIp(event)
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
          // No dedicated IP error page yet — surface as 403 with a
          // localised message. The hooks-based exam lock is the primary
          // enforcement path; this branch only fires when a student
          // navigates in directly.
          error(403, m.examShell_ipBlocked());
          break;
        case "not_started":
        case "ended":
          // Non-blocking: fall through to detail/problem loaders so the
          // student can still view the overview and (once ended) see
          // their own results.
          break;
      }
    }
  }

  return {
    exam: {
      id: exam.id,
      courseId,
      title: exam.title
    },
    course: {
      id: course.id,
      title: course.title,
      archived: course.archived
    },
    isManager
  };
});
