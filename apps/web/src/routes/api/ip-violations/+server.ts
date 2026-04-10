import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { listContestIpViolations } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const contestId = event.url.searchParams.get("contestId");

  // Homework assessments no longer have IP lock — only contests log
  // violations now. Reject any caller still passing `assessmentId`.
  if (!contestId) {
    return json({ error: "contestId required" }, { status: 400 });
  }

  // Only admins/teachers can view violation logs
  if (actor.platformRole === "student") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const violations = await listContestIpViolations({ contestId });

  return json({ violations });
});
