import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { listExamIpViolationsForActor } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const examId = event.params.examId;
  if (!examId) {
    return Response.json({ message: "examId required" }, { status: 400 });
  }

  const violations = await listExamIpViolationsForActor(actor, examId);

  return Response.json({ violations });
});
