import { error, fail } from "@sveltejs/kit";
import { examDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getExamDetailPage } = examDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { course, isManager } = parent;
  const actor = requireAuth(event);

  const detail = await getExamDetailPage(event.params.examId, {
    viewerUserId: actor.userId,
    isManager
  });

  if (detail?.courseId !== course.id) {
    error(404, "Exam not found");
  }

  return {
    detail,
    isManager,
    courseId: course.id
  };
});

export const actions = {
  /**
   * Student "Start exam" entry point. The real release/start endpoint
   * is owned by Phase 4 task 4.2 — until that lands we return a 501
   * with a stable shape so the page can render a placeholder banner
   * without breaking the form. Once the API endpoint exists this
   * action will simply forward to it (or redirect to
   * `/courses/[courseId]/exams/[examId]/problems/0` once the session
   * row is created).
   */
  startExam: (event) => {
    requireAuth(event);
    return fail(501, {
      error: "Exam session start endpoint is not implemented yet (Phase 4 task 4.2)."
    });
  }
} satisfies Actions;
