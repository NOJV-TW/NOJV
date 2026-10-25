import {
  getSecurityFactorState,
  securityGenerationProof,
  HttpError,
  hasTokenPageMfa,
} from "@nojv/application";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";

export const GET: RequestHandler = apiHandler(async (event) => {
  requireApiAuth(event);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (event.locals.apiTokenActor || !sessionId || !sessionUser) {
    throw new HttpError("Session authentication is required.", 401);
  }

  if (!(await getSecurityFactorState(sessionUser.id))?.hasSecurityFactor) {
    return Response.json({ setupRequired: true, verificationRequired: false });
  }

  const unlocked = await hasTokenPageMfa(sessionId, securityGenerationProof(sessionUser));
  return Response.json({ setupRequired: false, verificationRequired: !unlocked });
});
