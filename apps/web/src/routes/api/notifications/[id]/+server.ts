import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, assertJsonBodyWithinLimit } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/application";

const patchSchema = z.object({
  read: z.literal(true),
});

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing notification id." }, { status: 400 });

  patchSchema.parse(await event.request.json());
  const updated = await notificationDomain.markAsRead(actor.userId, id);
  return json({ updated });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing notification id." }, { status: 400 });

  await notificationDomain.deleteOne(actor.userId, id);
  return new Response(null, { status: 204 });
});
