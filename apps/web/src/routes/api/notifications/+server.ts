import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

// GET /api/notifications — list the caller's recent notifications + unread count.
// Query params (mutually exclusive — first hit wins):
//   ?count=true       → only `{ count }`, the unread-count badge cheap path.
//   ?filter=unread    → only the unread notifications (still capped by `limit`).
//   (no flag)         → full recent list + `unreadCount`.
//   ?limit=N          → cap the list size; 1..50, default 20.
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const params = event.url.searchParams;

  if (params.get("count") === "true") {
    const count = await notificationDomain.countUnread(actor.userId);
    return json({ count });
  }

  const limitRaw = Number(params.get("limit") ?? "20");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20), 50);
  const filter = params.get("filter");

  const [items, unreadCount] = await Promise.all([
    notificationDomain.listRecent(actor.userId, limit),
    notificationDomain.countUnread(actor.userId),
  ]);

  const filteredItems = filter === "unread" ? items.filter((n) => n.readAt === null) : items;
  return json({ items: filteredItems, unreadCount });
});

const patchSchema = z.object({
  action: z.literal("read-all"),
});

// PATCH /api/notifications  body { action: "read-all" } — bulk mark all
// of the caller's notifications as read. Per-item read state is updated
// via PATCH /api/notifications/[id].
export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  patchSchema.parse(await event.request.json());
  const updated = await notificationDomain.markAllAsRead(actor.userId);
  return json({ updated });
});

// DELETE /api/notifications — drop every notification belonging to the
// caller, regardless of read state. Caller can scope to read-only with
// `?filter=read`.
export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const filter = event.url.searchParams.get("filter");
  const onlyRead = filter === "read";
  const deleted = await notificationDomain.deleteAll(actor.userId, { onlyRead });
  return json({ deleted });
});
