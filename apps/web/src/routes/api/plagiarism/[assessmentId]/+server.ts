import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { ForbiddenError, getCoursePermissionRole, requireApiAuth } from "$lib/server/auth";
import { canManageCourse, plagiarismDomain } from "@nojv/domain";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";

const {
  resolvePlagiarismTarget,
  createPlagiarismReport,
  findPlagiarismReport,
  getPlagiarismSourceCode,
  dispatchPlagiarismCheck
} = plagiarismDomain;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const assessmentId = event.params.assessmentId;
  if (!assessmentId) return json({ message: "Missing assessmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const { courseSlug, target } = await resolvePlagiarismTarget(assessmentId, type);
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("Only course staff can trigger plagiarism checks.");
  }

  await createPlagiarismReport(target, actor.userId);

  await dispatchPlagiarismCheck({
    targetId: target.id,
    targetType: target.type,
    triggeredById: actor.userId
  });

  return json({ targetId: target.id, status: "pending" }, { status: 202 });
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

  // PlagiarismReport is 1:1 with its parent now — at most one row per
  // contest / assessment. We still return an array in the response so
  // existing clients (which poll `reports[0]`) keep working.
  const report = await findPlagiarismReport(target);

  return json({ reports: report ? [report] : [] });
});
