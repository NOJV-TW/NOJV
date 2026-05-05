import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const limitRaw = Number(event.url.searchParams.get("limit") ?? "20");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20), 100);
  const [items, unreadCount] = await Promise.all([
    notificationDomain.listRecent(actor.userId, limit),
    notificationDomain.countUnread(actor.userId),
  ]);
  return json({ items, unreadCount });
});
