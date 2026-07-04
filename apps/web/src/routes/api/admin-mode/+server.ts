import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { clearAdminMode, markAdminMode } from "$lib/server/step-up";

const bodySchema = z.object({ active: z.boolean() });

export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);

  if (event.locals.sessionUser?.platformRole !== "admin") {
    throw new HttpError("Only admin accounts can switch into admin mode.", 403);
  }
  const sessionId = event.locals.session?.id;
  if (!sessionId) {
    throw new HttpError("No active session.", 401);
  }

  const { active } = bodySchema.parse(await event.request.json());
  if (active) {
    await markAdminMode(sessionId);
  } else {
    await clearAdminMode(sessionId);
  }
  return json({ active });
});
