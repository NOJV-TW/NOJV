import { examDomain, type proctoringDomain } from "@nojv/domain";

export type ActiveExamContext = NonNullable<
  Awaited<ReturnType<typeof examDomain.session.getActiveSessionContext>>
>;

type ProctoringVerdict = Awaited<ReturnType<typeof proctoringDomain.checkProctoringGate>>;

export interface ExamGateDenial {
  status: number;
  code: string;
  scope: "all" | "api";
}

const API_BLOCKING_REASONS = new Set([
  "not_enrolled",
  "course_archived",
  "not_published",
  "not_found",
]);

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

export function isExamForbiddenApiPath(cleanPath: string): boolean {
  return cleanPath.startsWith("/api/contests/");
}

export function isAllowedPathForExam(pathname: string, ctx: ActiveExamContext): boolean {
  if (pathname.startsWith("/api/")) return true;

  if (pathname === "/signin" || pathname.startsWith("/signin/")) return true;
  if (pathname === "/signout" || pathname.startsWith("/signout/")) return true;

  const examPrefix = `/exams/${ctx.exam.id}`;
  if (pathname === examPrefix) return true;
  if (pathname.startsWith(examPrefix + "/")) return true;

  return false;
}
