import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

// Cancellation is non-destructive — it stops dispatching further child judges;
// already-completed re-judges stand and the batch can be re-run. The workflowId
// capability token (see GET) gates who can reach it.
export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  await submissionDomain.cancelRejudge(workflowId);
  return json({ status: "cancelled" });
});
