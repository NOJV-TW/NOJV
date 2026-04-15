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
  // TODO: forward to the real start endpoint once Phase 4 task 4.2 lands.
  startExam: (event) => {
    requireAuth(event);
    return fail(501, {
      error: "Exam session start endpoint is not implemented yet (Phase 4 task 4.2)."
    });
  }
} satisfies Actions;
