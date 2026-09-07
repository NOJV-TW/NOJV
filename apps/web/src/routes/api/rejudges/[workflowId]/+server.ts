import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  return json(await submissionDomain.queryRejudgeProgress(actor, workflowId));
});
