// Exam session lock — Phase 4 Task 4.1 of the course experience redesign.
//
// The spec (§4.7 State B) says: once a student has an active exam session,
// every navigation must be rerouted back to the exam. This module exposes
// the two primitives the `hooks.server.ts` wrapper needs:
//
//   - `getActiveExamContext(userId)` — a thin passthrough to
//     `examDomain.session.getActiveSessionContext` so the hook has a stable
//     import surface to mock/replace.
//   - `isAllowedPathForExam(pathname, ctx)` — a pure predicate that decides
//     whether a (locale-stripped) pathname is permitted for a user whose
//     active exam session is described by `ctx`.
//
// The allow list is intentionally tight:
//
//   - `/api/*` — every API endpoint. The exam flow itself depends on
//     heartbeat + release API routes, and more broadly, redirecting an API
//     request would produce confusing client behaviour. Scope creep is
//     limited because authenticated API routes still do their own
//     authorization.
//   - The exam's own route subtree (`/courses/<courseId>/exams/<examId>/`)
//     and the bare landing path (`/courses/<courseId>/exams/<examId>`).
//   - `/signin` + `/signout` — the session may expire mid-exam and the
//     student needs a way to re-authenticate. Letting them fall all the way
//     back to the sign-in page is preferable to a redirect loop.
//
// Everything else is denied; the hook responds with a 307 redirect back to
// the exam's first problem page and records a `visibility_lost` audit event.

import { examDomain } from "@nojv/domain";

export type ActiveExamContext = NonNullable<
  Awaited<ReturnType<typeof examDomain.session.getActiveSessionContext>>
>;

/**
 * Fetch the active exam session context for `userId`, or `null` if the user
 * is not currently in an exam. Delegates to the domain module; kept as a
 * separate file so the hook has a small, focused import surface.
 */
export async function getActiveExamContext(userId: string): Promise<ActiveExamContext | null> {
  return examDomain.session.getActiveSessionContext(userId);
}

/**
 * True if `pathname` (already stripped of the paraglide locale prefix) is
 * allowed for a user whose active exam session is described by `ctx`.
 */
export function isAllowedPathForExam(pathname: string, ctx: ActiveExamContext): boolean {
  // Authenticated APIs — exam heartbeat / release endpoints plus anything
  // else the page running inside the exam needs to call.
  if (pathname.startsWith("/api/")) return true;

  // Session recovery — don't trap a student whose session expired.
  if (pathname === "/signin" || pathname.startsWith("/signin/")) return true;
  if (pathname === "/signout" || pathname.startsWith("/signout/")) return true;

  // The exam's own route tree. Match both the exact landing path and any
  // nested child route.
  const examPrefix = `/courses/${ctx.course.id}/exams/${ctx.exam.id}`;
  if (pathname === examPrefix) return true;
  if (pathname.startsWith(examPrefix + "/")) return true;

  return false;
}
