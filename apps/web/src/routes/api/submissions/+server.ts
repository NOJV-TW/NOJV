import { MAX_SUBMISSION_BODY_BYTES, submissionDraftSchema } from "@nojv/core";
import { submissionDomain, HttpError } from "@nojv/application";
import { error, json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler, readJsonBody } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";

const SUBMISSIONS_PAGE_SIZE = 50;

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const cursor = event.url.searchParams.get("cursor")?.trim();
  const page = await submissionDomain.listUserSubmissions({
    userId: actor.userId,
    limit: SUBMISSIONS_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  return json(page);
});

function submitRejectionBody(err: HttpError): { code: string; retryAfterSec?: number } {
  const message = err.message;
  if (/cooldown/i.test(message)) {
    const seconds = Number(/(\d+)/.exec(message)?.[1] ?? "");
    return Number.isFinite(seconds) && seconds > 0
      ? { code: "submit_cooldown", retryAfterSec: seconds }
      : { code: "submit_cooldown" };
  }
  if (/daily submission limit/i.test(message)) return { code: "daily_limit" };
  if (/(has ended|has not opened)/i.test(message)) return { code: "window_closed" };
  if (/(network does not match|network is not permitted|ip restrictions)/i.test(message)) {
    return { code: "ip_blocked" };
  }
  if (/language not allowed/i.test(message)) return { code: "language_not_allowed" };
  return { code: "submit_rejected" };
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const declared = Number(event.request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SUBMISSION_BODY_BYTES) {
    error(413, "Request body too large");
  }

  const payload = submissionDraftSchema.parse(
    await readJsonBody(event, MAX_SUBMISSION_BODY_BYTES),
  );

  try {
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
  } catch (err) {
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
      return json(
        { message: err.message, ...submitRejectionBody(err) },
        { status: err.status },
      );
    }
    throw err;
  }
});
