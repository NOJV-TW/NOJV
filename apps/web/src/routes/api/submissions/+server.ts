import { submissionDraftSchema } from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import { error, json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";

const SUBMISSION_BODY_LIMIT = 2 * 1024 * 1024;

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const declared = Number(event.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SUBMISSION_BODY_LIMIT) {
    error(413, "Request body too large");
  }

  const payload = submissionDraftSchema.parse(await event.request.json());

  const submission = await submissionDomain.submitAndDispatch(
    payload,
    actor,
    getClientIp(event),
  );

  return json(
    {
      pollUrl: `/api/submissions/${submission.id}`,
      status: submission.status,
      submissionId: submission.id,
    },
    { status: 202 },
  );
});
