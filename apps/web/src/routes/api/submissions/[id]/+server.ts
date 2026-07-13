import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/application";
import { submissionResultSchema } from "@nojv/core";

const { getSubmissionForActor, getVerdictDetail, sanitizeStudentResult } = submissionDomain;

function sanitizeVerdictDetail(raw: unknown, sampleOnly: boolean): unknown {
  if (raw === null || raw === undefined) return raw;
  const parsed = submissionResultSchema.safeParse(raw);
  return parsed.success ? sanitizeStudentResult(parsed.data, { sampleOnly }) : null;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForActor(actor, id);

  const detail = submission.verdictDetailStorageKey ? await getVerdictDetail(id) : null;

  return json({
    result: sanitizeVerdictDetail(detail, submission.sampleOnly),
    status: submission.status,
    submissionId: submission.id,
  });
});
