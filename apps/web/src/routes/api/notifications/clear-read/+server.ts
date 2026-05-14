import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

// POST /api/notifications/clear-read — bulk delete every already-read
// notification belonging to the caller. Unread notifications are kept.
// Returns `{ deleted }`. Idempotent.
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const deleted = await notificationDomain.deleteAll(actor.userId, { onlyRead: true });
  return json({ deleted });
});
