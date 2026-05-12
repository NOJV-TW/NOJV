import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { ForbiddenError, getCoursePermissionRole, requireApiAuth } from "$lib/server/auth";
import { canManageCourse, plagiarismDomain } from "@nojv/domain";
import { contestRepo } from "@nojv/db";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";

const {
  resolvePlagiarismTarget,
  createPlagiarismReport,
  findPlagiarismReport,
  getPlagiarismSourceCode,
  dispatchPlagiarismCheck,
} = plagiarismDomain;

async function assertCanManagePlagiarism(
  event: Parameters<typeof requireApiAuth>[0],
  resolved: Awaited<ReturnType<typeof resolvePlagiarismTarget>>,
  denialMessage: string,
): Promise<void> {
  const actor = requireApiAuth(event);
  // Contest plagiarism: domain returns empty courseId since contests are not
  // course-bound. Fall back to organizer / platform-admin authorization.
  if (resolved.target.type === "contest") {
    if (actor.platformRole === "admin") return;
    const contest = await contestRepo.findById(resolved.target.id);
    if (contest?.createdByUserId === actor.userId) return;
    throw new ForbiddenError(denialMessage);
  }
  const role = await getCoursePermissionRole(resolved.courseId, actor);
  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError(denialMessage);
  }
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await resolvePlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can trigger plagiarism checks.");

  const { target } = resolved;
  await createPlagiarismReport(target, actor.userId);

  await dispatchPlagiarismCheck({
    targetId: target.id,
    targetType: target.type,
    triggeredById: actor.userId,
  });

  return json({ targetId: target.id, status: "pending" }, { status: 202 });
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await resolvePlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can view plagiarism reports.");

  const { target } = resolved;

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

  // Report is 1:1 with its parent, but the response is still an array so `reports[0]` clients keep working.
  const report = await findPlagiarismReport(target);

  return json({ reports: report ? [report] : [] });
});
