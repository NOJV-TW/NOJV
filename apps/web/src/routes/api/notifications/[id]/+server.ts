import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

const patchSchema = z.object({
  read: z.literal(true),
});

// PATCH /api/notifications/[id]  body { read: true } — mark a single
// notification as read. `read: false` is intentionally not supported
// (notifications are write-once after delivery).
export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing notification id." }, { status: 400 });

  patchSchema.parse(await event.request.json());
  const updated = await notificationDomain.markAsRead(actor.userId, id);
  return json({ updated });
});
