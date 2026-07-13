import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, readJsonBody } from "$lib/server/shared/api-handler";
import { grantAdminElevation, revokeAdminElevation } from "$lib/server/step-up";

const bodySchema = z.object({ active: z.boolean() });

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const sessionId = event.locals.session?.id;
  if (!sessionId) {
    throw new HttpError("No active session.", 401);
  }

  const { active } = bodySchema.parse(await readJsonBody(event));
  if (!active) {
    await revokeAdminElevation(sessionId);
    return json({ active: false });
  }
  if (!(await grantAdminElevation(sessionId, actor.userId))) {
    throw new HttpError("Fresh two-factor verification is required.", 403);
  }
  return json({ active: true });
});
