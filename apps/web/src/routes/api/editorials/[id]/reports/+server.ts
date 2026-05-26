import { z } from "zod";
import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { editorialDomain } from "@nojv/domain";

const { reportEditorial } = editorialDomain;

const editorialReportSchema = z.object({
  reason: z.string().min(1).max(1000),
});

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Editorial id is required.", 400);
  return id;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = editorialReportSchema.parse(await event.request.json());

  const report = await reportEditorial(actor, id, payload.reason);
  return json(report, { status: 201 });
});
