import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

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

const patchSchema = z.object({
  action: z.literal("markAllRead"),
});

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  patchSchema.parse(await event.request.json());
  const updated = await notificationDomain.markAllAsRead(actor.userId);
  return json({ updated });
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const status = event.url.searchParams.get("status");
  if (status !== "read") {
    return json(
      { message: "DELETE /api/notifications requires ?status=read." },
      { status: 400 },
    );
  }
  await notificationDomain.deleteAll(actor.userId, { onlyRead: true });
  return new Response(null, { status: 204 });
});
