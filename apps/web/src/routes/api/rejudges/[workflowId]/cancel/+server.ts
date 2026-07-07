import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { workflowId } = event.params;
  if (!workflowId) return json({ message: "Missing workflowId" }, { status: 400 });

  const triggeredBy = await submissionDomain.getRejudgeTriggeredBy(workflowId);
  if (actor.platformRole !== "admin" && triggeredBy !== actor.userId) {
    return json({ message: "Forbidden" }, { status: 403 });
  }

  await submissionDomain.cancelRejudge(workflowId);
  return json({ status: "cancelled" });
});
