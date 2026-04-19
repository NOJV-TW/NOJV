import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const updated = await notificationDomain.markAllAsRead(actor.userId);
  return json({ updated });
});
