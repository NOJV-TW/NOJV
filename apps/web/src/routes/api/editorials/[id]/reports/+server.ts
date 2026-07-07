import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { editorialReportSchema } from "@nojv/core";
import { editorialDomain } from "@nojv/application";

const { reportEditorial } = editorialDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Editorial id is required.", 400);
  return id;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = editorialReportSchema.parse(await readJsonBody(event));

  const report = await reportEditorial(actor, id, payload.reason);
  return json(report, { status: 201 });
});
