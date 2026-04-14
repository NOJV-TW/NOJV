import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { listExamIpViolations } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  // IP violations are only recorded on exams now (proctoring moved
  // off standalone contests as part of the 2026-04-14 split).
  const examId = event.url.searchParams.get("examId");

  if (!examId) {
    return json({ error: "examId required" }, { status: 400 });
  }

  if (actor.platformRole === "student") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const violations = await listExamIpViolations({ examId });

  return json({ violations });
});
