import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

// GET /api/notifications — list the caller's recent notifications + unread count.
//   ?limit=N — cap the list size; 1..50, default 20.
// Sub-resources:
//   GET  /api/notifications/unread-count — cheap unread badge count
//   POST /api/notifications/read-all     — bulk mark every notification as read
//   POST /api/notifications/clear-read   — bulk delete every already-read notification
//   PATCH /api/notifications/[id]        — mark a single notification as read
//   DELETE /api/notifications/[id]       — drop a single notification
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const limitRaw = Number(event.url.searchParams.get("limit") ?? "20");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20), 50);

  const [items, unreadCount] = await Promise.all([
    notificationDomain.listRecent(actor.userId, limit),
    notificationDomain.countUnread(actor.userId),
  ]);

  return json({ items, unreadCount });
});
