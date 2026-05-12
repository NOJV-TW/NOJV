import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { notificationDomain } from "@nojv/domain";

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
