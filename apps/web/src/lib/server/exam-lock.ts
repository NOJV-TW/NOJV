import { examDomain, type proctoringDomain } from "@nojv/application";

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

const EXAM_FORBIDDEN_API_PREFIXES = ["/api/contests/", "/api/posts/", "/api/comments/"];
const EXAM_FORBIDDEN_PROBLEM_POSTS_PATTERN = /^\/api\/problems\/[^/]+\/posts(?:\/|$)/;
const SUBMISSION_POINT_PATTERN = /^\/api\/submissions\/[^/]+$/;
const SUBMISSION_SOURCE_PATTERN = /^\/api\/submissions\/[^/]+\/source$/;

export function isExamForbiddenApiRequest(cleanPath: string, method: string): boolean {
  if (EXAM_FORBIDDEN_API_PREFIXES.some((prefix) => cleanPath.startsWith(prefix))) {
    return true;
  }
  if (EXAM_FORBIDDEN_PROBLEM_POSTS_PATTERN.test(cleanPath)) return true;

  if (!cleanPath.startsWith("/api/submissions")) return false;
  if (cleanPath === "/api/submissions") return method !== "GET" && method !== "POST";
  if (SUBMISSION_POINT_PATTERN.test(cleanPath)) return method !== "GET";
  if (SUBMISSION_SOURCE_PATTERN.test(cleanPath)) return method !== "GET";
  return true;
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
