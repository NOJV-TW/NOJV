import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { submissionDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return Response.json({ message: "Missing workflowId" }, { status: 400 });

  return Response.json(await submissionDomain.queryRejudgeProgress(actor, workflowId));
});
