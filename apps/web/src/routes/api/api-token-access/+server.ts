import { securityGenerationProof } from "@nojv/application";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { hasTokenPageMfa, isTwoFactorActivated } from "$lib/server/step-up";
import { apiHandler } from "$lib/server/shared/api-handler";

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (event.locals.apiTokenActor || !sessionId || !sessionUser) {
    throw new HttpError("Session authentication is required.", 401);
  }

  if (!(await isTwoFactorActivated(sessionUser.id))) {
    return json({ setupRequired: true, verificationRequired: false });
  }

  const unlocked = await hasTokenPageMfa(sessionId, securityGenerationProof(sessionUser));
  return json({ setupRequired: false, verificationRequired: !unlocked });
});
