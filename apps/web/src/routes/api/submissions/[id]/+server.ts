import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";
import { submissionResultSchema } from "@nojv/core";

const { getSubmissionForUser, stripStaffFeedback } = submissionDomain;

// This polling endpoint serves the submitter (getSubmissionForUser 404s
// non-admin non-owners). Treat every response as non-staff and strip the
// operator-only staffFeedback channel before the JSON hits the wire.
function sanitizeVerdictDetail(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const parsed = submissionResultSchema.safeParse(raw);
  return parsed.success ? stripStaffFeedback(parsed.data) : raw;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForUser(
    id,
    actor.userId,
    actor.platformRole === "admin",
  );

  return json({
    result: sanitizeVerdictDetail(submission.verdictDetail),
    status: submission.status,
    submissionId: submission.id,
  });
});
