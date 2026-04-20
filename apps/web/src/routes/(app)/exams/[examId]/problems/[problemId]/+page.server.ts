import { error } from "@sveltejs/kit";

import { examDomain } from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

// Id-unified exam problem loader.  Mirrors the existing
// `/courses/[courseId]/exams/[examId]/problems/[idx]/+page.server.ts` but
// looks the problem up by id directly.  The shared `problem-solve.ts`
// helper is not used here because exam mode ships additional props
// (`siblingProblems`, `examContext`) that the helper's uniform shape
// doesn't cover; inline so a later pass can extract once the cross-
// family contract stabilises.
export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { examId, problemId } = event.params;

  // Defense in depth so a bypassed `hooks.server.ts` exam lock cannot
  // expose exam content outside an active session.
  await examDomain.session.requireActiveSessionForUserExam(actor.userId, examId);

  const view = await examDomain.getExamProblemViewByProblemId({
    examId,
    problemId,
    actorUserId: actor.userId,
  });

  if (!view) {
    error(404, "Problem not found in this exam");
  }

  // countdownMs is computed server-side so the page has a sane initial
  // value before the client tick takes over.  Negative values are
  // clamped — an expired exam still renders briefly while hooks
  // redirect.
  const countdownMs = Math.max(0, new Date(view.exam.endsAt).getTime() - Date.now());

  return {
    mode: "exam" as const,
    problem: view.problem,
    submissions: view.submissions,
    siblingProblems: view.siblingProblems,
    // Exam problem page is a student-only surface (hooks.server.ts locks
    // staff out of active exam sessions). Rejudge belongs on the staff
    // manage pages, so hide the UI here unconditionally.
    canRejudge: false,
    examContext: {
      examId,
      courseId: view.exam.courseId,
      examTitle: view.examTitle,
      courseLabel: view.courseLabel,
      endsAt: view.exam.endsAt,
      countdownMs,
      userHandle: actor.username,
      ipAddress: getClientIp(event),
    },
  };
});
