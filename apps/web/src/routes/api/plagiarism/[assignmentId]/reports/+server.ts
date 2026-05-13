import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { assertCanManagePlagiarism } from "$lib/server/plagiarism-pair";
import { plagiarismDomain } from "@nojv/domain";

const {
  resolvePlagiarismTarget,
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

// GET /api/plagiarism/[assignmentId]/reports — list reports for the target.
// Source-code fetching has moved to `/api/plagiarism/[assignmentId]/source`.
export const GET: RequestHandler = apiHandler(async (event) => {
  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await resolvePlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can view plagiarism reports.");

  // Report is 1:1 with its parent, but the response is still an array so `reports[0]` clients keep working.
  const report = await findPlagiarismReport(resolved.target);

  return json({ reports: report ? [report] : [] });
});
