import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  await submissionDomain.cancelRejudge(workflowId);
  return json({ status: "cancelled" });
});
