import { json } from "@sveltejs/kit";
import { z } from "zod";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, readJsonBody } from "$lib/server/shared/api-handler";
import {
  adminElevationPrincipal,
  grantAdminElevation,
  revokeAdminElevation,
} from "$lib/server/step-up";

const bodySchema = z.object({ active: z.boolean() });

export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (!sessionId || !sessionUser) {
    throw new HttpError("No active session.", 401);
  }

  const { active } = bodySchema.parse(await readJsonBody(event));
  if (!active) {
    await revokeAdminElevation(sessionId);
    return json({ active: false });
  }
  if (sessionUser.platformRole !== "admin") {
    throw new HttpError("Admin mode is not available for this account.", 403);
  }
  if (!(await grantAdminElevation(sessionId, adminElevationPrincipal(sessionUser)))) {
    return json({ active: false, verificationRequired: true });
  }
  return json({ active: true });
});
