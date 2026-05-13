import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

// GET /api/notifications/unread-count — cheap unread badge count for the
// caller. Returns `{ count }`. Polled by the navbar bell badge.
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const count = await notificationDomain.countUnread(actor.userId);
  return json({ count });
});
