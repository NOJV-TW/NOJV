import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { notificationDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const count = await notificationDomain.countUnread(actor.userId);
  return Response.json({ count });
});
