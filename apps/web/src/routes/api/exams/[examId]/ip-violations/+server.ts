import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { listExamIpViolations } from "@nojv/domain";

// GET /api/exams/[examId]/ip-violations — list IP-lock violations recorded
// during the given exam. Staff-only; students 403. IP violations are only
// recorded on exams (proctoring moved off standalone contests as part of
// the 2026-04-14 split).
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const examId = event.params.examId;
  if (!examId) {
    return json({ error: "examId required" }, { status: 400 });
  }

  if (actor.platformRole === "student") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const violations = await listExamIpViolations({ examId });

  return json({ violations });
});
