import type { RequestEvent } from "@sveltejs/kit";

import {
  adminMfaKind,
  consumeStepUpHandoffTicket,
  markVerifiedSession,
  unlockSecuritySettings,
} from "@nojv/application";

export const STEP_UP_HANDOFF_COOKIE = "nojv.step_up_handoff";

export async function consumeStepUpHandoff(event: RequestEvent): Promise<boolean> {
  const ticket = event.cookies.get(STEP_UP_HANDOFF_COOKIE);
  if (!ticket) return false;

  event.cookies.delete(STEP_UP_HANDOFF_COOKIE, { path: "/" });
  const proof = await consumeStepUpHandoffTicket(ticket);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (
    !sessionId ||
    !sessionUser ||
    proof?.userId !== sessionUser.id ||
    proof.securityGeneration !== sessionUser.securityGeneration
  ) {
    return false;
  }

  const securityProof = {
    securityGeneration: proof.securityGeneration,
    userId: proof.userId,
  };

  return proof.kind === "verified"
    ? markVerifiedSession(sessionId, securityProof, adminMfaKind(sessionUser))
    : unlockSecuritySettings(sessionId, securityProof);
}
