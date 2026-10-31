import {
  HttpError,
  adminAccessPrincipal,
  exitAdminMode,
  grantAdminMode,
} from "@nojv/application";
import { adminModeRequestSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler, readJsonBody } from "#lib/server/shared/api-handler.js";
import {
  DEV_ADMIN_MODE_COOKIE,
  isDevAdminModeBypassEnabled,
} from "#lib/server/dev-admin-mode.js";
import { getWebEnv } from "#lib/server/env.js";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  requireApiAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (!sessionId || !sessionUser) {
    throw new HttpError("No active session.", 401);
  }

  const { active } = adminModeRequestSchema.parse(await readJsonBody(event));
  if (sessionUser.isSuperAdmin) {
    throw new HttpError("Super admins do not use Admin mode.", 403);
  }
  if (!active) {
    await exitAdminMode(sessionId);
    if (isDevAdminModeBypassEnabled(sessionUser, getWebEnv())) {
      event.cookies.set(DEV_ADMIN_MODE_COOKIE, "off", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
    }
    return Response.json({ active: false });
  }
  if (sessionUser.platformRole !== "admin") {
    throw new HttpError("Admin mode is not available for this account.", 403);
  }
  if (isDevAdminModeBypassEnabled(sessionUser, getWebEnv())) {
    event.cookies.delete(DEV_ADMIN_MODE_COOKIE, { path: "/" });
    return Response.json({ active: true });
  }
  if (!(await grantAdminMode(sessionId, adminAccessPrincipal(sessionUser)))) {
    return Response.json({ active: false, verificationRequired: true });
  }
  return Response.json({ active: true });
});
