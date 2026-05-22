import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { listExamIpViolationsForActor } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const examId = event.params.examId;
  if (!examId) {
    return json({ message: "examId required" }, { status: 400 });
  }

  const violations = await listExamIpViolationsForActor(actor, examId);

  return json({ violations });
});
