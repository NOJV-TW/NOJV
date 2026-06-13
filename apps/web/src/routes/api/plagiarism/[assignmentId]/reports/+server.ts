import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { assertCanManagePlagiarism } from "$lib/server/plagiarism-pair";
import { plagiarismDomain } from "@nojv/application";

const {
  getPlagiarismTarget,
  createPlagiarismReport,
  findPlagiarismReport,
  dispatchPlagiarismCheck,
} = plagiarismDomain;

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

  const pollUrl = new URL(event.url);
  pollUrl.search = type ? `?type=${encodeURIComponent(type)}` : "";
  return json(
    { targetId: target.id, status: "pending" },
    { status: 202, headers: { Location: pollUrl.pathname + pollUrl.search } },
  );
});

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);

  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const resolved = await getPlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(event, resolved, "Only staff can view plagiarism reports.");

  const report = await findPlagiarismReport(resolved.target);

  return json({ reports: report ? [report] : [] });
});
