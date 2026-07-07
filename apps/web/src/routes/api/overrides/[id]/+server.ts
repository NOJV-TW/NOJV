import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { scoreOverrideDomain } from "@nojv/application";

const patchSchema = z.object({
  overrideScore: z.number().int().min(0).optional(),
  reason: z.string().min(1).max(500).optional(),
});

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Override id is required.", 400);
  return id;
}

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const raw = patchSchema.parse(await readJsonBody(event));
  const patch: Parameters<typeof scoreOverrideDomain.updateOverride>[2] = {
    ...(raw.overrideScore !== undefined ? { overrideScore: raw.overrideScore } : {}),
    ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
  };
  const updated = await scoreOverrideDomain.updateOverride(actor, id, patch);
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  await scoreOverrideDomain.deleteOverride(actor, id);
  return new Response(null, { status: 204 });
});
