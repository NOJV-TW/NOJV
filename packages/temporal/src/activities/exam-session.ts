import { examDomain } from "@nojv/domain";

/**
 * Close every active exam session for `examId`. Called by the
 * `examAutoCloseWorkflow` once `exam.endsAt` has passed. Delegates
 * to the domain layer, which writes `releaseReason = "time_up"` and
 * an `auto_close` audit event on each affected session.
 */
export async function closeActiveSessionsForExam(examId: string): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(examId);
}
