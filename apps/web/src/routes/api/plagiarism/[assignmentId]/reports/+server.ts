import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { assertCanManagePlagiarism } from "$lib/server/plagiarism-pair";
import { plagiarismDomain } from "@nojv/domain";

const {
  getPlagiarismTarget,
  createPlagiarismReport,
  findPlagiarismReport,
  dispatchPlagiarismCheck,
} = plagiarismDomain;

// POST /api/plagiarism/[assignmentId]/reports — trigger a fresh plagiarism
// check. Returns 202; the workflow completes asynchronously.
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await getPlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can trigger plagiarism checks.");

  const { target } = resolved;
  await createPlagiarismReport(target, actor.userId);

  await dispatchPlagiarismCheck({
    targetId: target.id,
    targetType: target.type,
    triggeredById: actor.userId,
  });

  // Clients poll GET on the same collection URL to see when the report
  // appears (`reports[0].status` flips to "completed"). The Location
  // header points there per RFC 7231 §6.3.3.
  const pollUrl = new URL(event.url);
  pollUrl.search = type ? `?type=${encodeURIComponent(type)}` : "";
  return json(
    { targetId: target.id, status: "pending" },
    { status: 202, headers: { Location: pollUrl.pathname + pollUrl.search } },
  );
});

// GET /api/plagiarism/[assignmentId]/reports — list reports for the target.
// Source-code fetching lives at `/api/plagiarism/[assignmentId]/sources/[userId]/[problemId]`.
export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);

  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await getPlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can view plagiarism reports.");

  // Report is 1:1 with its parent, but the response is still an array so `reports[0]` clients keep working.
  const report = await findPlagiarismReport(resolved.target);

  return json({ reports: report ? [report] : [] });
});
