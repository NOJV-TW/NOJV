import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";
import { submissionDomain } from "@nojv/application";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return Response.json({ message: "Missing workflowId" }, { status: 400 });

  const result = await submissionDomain.cancelRejudge(actor, workflowId);
  return Response.json(result, { status: result.status === "requested" ? 202 : 200 });
});
