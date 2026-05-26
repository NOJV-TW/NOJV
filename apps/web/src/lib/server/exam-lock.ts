import { examDomain, type proctoringDomain } from "@nojv/domain";

export type ActiveExamContext = NonNullable<
  Awaited<ReturnType<typeof examDomain.session.getActiveSessionContext>>
>;

type ProctoringVerdict = Awaited<ReturnType<typeof proctoringDomain.checkProctoringGate>>;

export interface ExamGateDenial {
  /** HTTP status to return. */
  status: number;
  /** Machine-readable code for the JSON body / client handling. */
  code: string;
  /** `all` blocks pages + /api (IP failures); `api` blocks /api only. */
  scope: "all" | "api";
}

// Authorization failures with no legitimate reason to keep serving a mid-exam
// request. `ended` / `not_started` are deliberately excluded: the submission
// gate already blocks the security-relevant action and the auto-close workflow
// ends the session within seconds, so blocking them would only 4xx legitimate
// end-of-exam verdict reads / release calls.
const API_BLOCKING_REASONS = new Set([
  "not_enrolled",
  "course_archived",
  "not_published",
  "not_found",
]);

/**
 * Decide how hooks should treat a proctoring-gate verdict on the current path.
 * Returns null to allow. IP failures block every surface; structural authz
 * failures block `/api` only and leave pages to the exam-shell loaders, which
 * render a graceful state rather than a bare error page.
 */
export function resolveExamGateDenial(
  verdict: ProctoringVerdict,
  cleanPath: string,
): ExamGateDenial | null {
  if (verdict.ok) return null;
  if (verdict.reason === "ip_whitelist" || verdict.reason === "ip_binding") {
    return { scope: "all", status: 403, code: "exam_ip_blocked" };
  }
  if (cleanPath.startsWith("/api/") && API_BLOCKING_REASONS.has(verdict.reason)) {
    return { scope: "api", status: 403, code: `exam_${verdict.reason}` };
  }
  return null;
}

export async function getActiveExamContext(userId: string): Promise<ActiveExamContext | null> {
  return examDomain.session.getActiveSessionContext(userId);
}

// `pathname` is already stripped of the paraglide locale prefix.
export function isAllowedPathForExam(pathname: string, ctx: ActiveExamContext): boolean {
  if (pathname.startsWith("/api/")) return true;

  // Session recovery — don't trap a student whose session expired.
  if (pathname === "/signin" || pathname.startsWith("/signin/")) return true;
  if (pathname === "/signout" || pathname.startsWith("/signout/")) return true;

  const examPrefix = `/exams/${ctx.exam.id}`;
  if (pathname === examPrefix) return true;
  if (pathname.startsWith(examPrefix + "/")) return true;

  return false;
}
