import { examDomain } from "@nojv/domain";

export type ActiveExamContext = NonNullable<
  Awaited<ReturnType<typeof examDomain.session.getActiveSessionContext>>
>;

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
