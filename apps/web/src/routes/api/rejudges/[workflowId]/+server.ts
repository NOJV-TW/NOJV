import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

// The workflowId is a capability token: it is returned only to the staff member
// who started the batch (POST /api/rejudges) and embeds a millisecond timestamp,
// so any authenticated caller holding it may poll progress.
export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  try {
    const progress = await submissionDomain.queryRejudgeProgress(workflowId);
    return json({ ...progress, done: false });
  } catch {
    // Querying a closed/cancelled/absent workflow throws — treat as finished so
    // the client stops polling.
    return json({ completed: 0, total: 0, done: true });
  }
});
