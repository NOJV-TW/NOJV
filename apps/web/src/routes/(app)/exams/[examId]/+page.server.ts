import { error, fail } from "@sveltejs/kit";
import { examDomain } from "@nojv/domain";

import type { Actions, PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getExamDetailPage } = examDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const parent = await event.parent();
  const { exam: examHeader, isManager } = parent;
  const actor = requireAuth(event);

  const detail = await getExamDetailPage(event.params.examId, {
    viewerUserId: actor.userId,
    isManager
  });

  // The layout gate already accepted this exam for the viewer; treat a
  // null payload here (draft hidden from students, archived, etc.) as a
  // defense-in-depth 404 rather than a crash.
  if (detail?.courseId !== examHeader.courseId) {
    error(404, "Exam not found");
  }

  return {
    detail,
    isManager,
    courseId: examHeader.courseId
  };
});

export const actions = {
  // TODO: forward to the real start endpoint once the `/api/exam-session/start`
  // call is wired up through this shell.  Kept as a placeholder so the detail
  // page's <form action="?/startExam"> round-trips locally.
  startExam: (event) => {
    requireAuth(event);
    return fail(501, {
      error: "Exam session start endpoint is not implemented yet."
    });
  }
} satisfies Actions;
