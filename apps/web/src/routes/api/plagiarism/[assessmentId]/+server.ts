import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { ForbiddenError, getCoursePermissionRole, requireApiAuth } from "$lib/server/auth";
import { canManageCourse, plagiarismDomain } from "@nojv/domain";
import { apiHandler } from "$lib/server/shared/api-handler";
import { writeApiRateLimiter } from "$lib/server/shared/rate-limiter";

const {
  resolvePlagiarismTarget,
  createPlagiarismReport,
  listPlagiarismReports,
  getPlagiarismSourceCode,
  dispatchPlagiarismCheck
} = plagiarismDomain;

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  try {
    await writeApiRateLimiter.consume(event.getClientAddress());
  } catch {
    return json({ error: "Too many requests" }, { status: 429 });
  }

  const assessmentId = event.params.assessmentId;
  if (!assessmentId) return json({ message: "Missing assessmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const { courseSlug, target } = await resolvePlagiarismTarget(assessmentId, type);
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can trigger plagiarism checks.");
  }

  const report = await createPlagiarismReport(target, actor.userId);

  await dispatchPlagiarismCheck({
    reportId: report.id,
    targetId: target.id,
    targetType: target.type,
    triggeredById: actor.userId
  });

  return json({ reportId: report.id, status: "pending" }, { status: 202 });
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const assessmentId = event.params.assessmentId;
  if (!assessmentId) return json({ message: "Missing assessmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const { courseSlug, target } = await resolvePlagiarismTarget(assessmentId, type);
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can view plagiarism reports.");
  }

  // If source=true, return a specific submission's source code for comparison
  const source = event.url.searchParams.get("source");
  if (source === "true") {
    const userId = event.url.searchParams.get("userId");
    const problemId = event.url.searchParams.get("problemId");

    if (!userId || !problemId) {
      return json({ message: "userId and problemId are required." }, { status: 400 });
    }

    const sourceCode = await getPlagiarismSourceCode(target, userId, problemId);
    return json({ sourceCode });
  }

  const reports = await listPlagiarismReports(target);

  return json({ reports });
});
