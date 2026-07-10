import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { contentReportSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { postDomain } from "@nojv/application";

const { reportContent } = postDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Comment id is required.", 400);
  return id;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = contentReportSchema.parse(await readJsonBody(event));

  const report = await reportContent(actor, { commentId: id }, payload.reason);
  return json(report, { status: 201 });
});
