import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { assertCanManagePlagiarism } from "$lib/server/plagiarism-pair";
import { plagiarismDomain } from "@nojv/application";

const { getPlagiarismTarget, getPlagiarismSourceCode } = plagiarismDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);

  const { assignmentId, userId, problemId } = event.params;
  if (!assignmentId || !userId || !problemId) {
    return json({ message: "Missing assignmentId, userId, or problemId." }, { status: 400 });
  }
  const type = event.url.searchParams.get("type");

  const resolved = await getPlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(
    event,
    resolved,
    "Only staff can view plagiarism source code.",
  );

  const files = await getPlagiarismSourceCode(resolved.target, userId, problemId);
  return json({ files });
});
