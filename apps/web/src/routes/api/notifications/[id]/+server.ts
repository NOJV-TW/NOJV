import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import {
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "#lib/server/shared/api-handler.js";
import { notificationDomain } from "@nojv/application";
import { notificationMarkReadSchema } from "@nojv/core";

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing notification id." }, { status: 400 });

  notificationMarkReadSchema.parse(await readJsonBody(event));
  const updated = await notificationDomain.markAsRead(actor.userId, id);
  return Response.json({ updated });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing notification id." }, { status: 400 });

  await notificationDomain.deleteOne(actor.userId, id);
  return new Response(null, { status: 204 });
});
