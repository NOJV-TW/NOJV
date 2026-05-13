import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { apiHandler } from "$lib/server/shared/api-handler";
import { assertCanManagePlagiarism } from "$lib/server/plagiarism-pair";
import { plagiarismDomain } from "@nojv/domain";

const { resolvePlagiarismTarget, getPlagiarismSourceCode } = plagiarismDomain;

// GET /api/plagiarism/[assignmentId]/source?userId=&problemId= — fetch a
// specific submission's source code for side-by-side diff in the plagiarism
// tooling. Staff-only; reuses the same access gate as the reports endpoint.
export const GET: RequestHandler = apiHandler(async (event) => {
  const assignmentId = event.params.assignmentId;
  if (!assignmentId) return json({ message: "Missing assignmentId." }, { status: 400 });
  const type = event.url.searchParams.get("type");

  const userId = event.url.searchParams.get("userId");
  const problemId = event.url.searchParams.get("problemId");
  if (!userId || !problemId) {
    return json({ message: "userId and problemId are required." }, { status: 400 });
  }

  const resolved = await resolvePlagiarismTarget(assignmentId, type);
  await assertCanManagePlagiarism(
    event,
    resolved,
    "Only staff can view plagiarism source code.",
  );

  const sourceCode = await getPlagiarismSourceCode(resolved.target, userId, problemId);
  return json({ sourceCode });
});
