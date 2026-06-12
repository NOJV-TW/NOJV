import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  try {
    const progress = await submissionDomain.queryRejudgeProgress(workflowId);
    return json({ ...progress, done: false });
  } catch {
    return json({ completed: 0, total: 0, done: true });
  }
});
