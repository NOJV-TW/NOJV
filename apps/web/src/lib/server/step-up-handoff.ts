import type { RequestEvent } from "@sveltejs/kit";

import {
  consumeStepUpHandoffTicket,
  markAdminSessionMfa,
  markStepUpFresh,
  markTokenPageMfa,
} from "@nojv/application";

export const STEP_UP_HANDOFF_COOKIE = "nojv.step_up_handoff";

export async function consumeStepUpHandoff(event: RequestEvent): Promise<boolean> {
  const ticket = event.cookies.get(STEP_UP_HANDOFF_COOKIE);
  if (!ticket) return false;

  event.cookies.delete(STEP_UP_HANDOFF_COOKIE, { path: "/" });
  const ticketUserId = await consumeStepUpHandoffTicket(ticket);
  const sessionId = event.locals.session?.id;
  const sessionUser = event.locals.sessionUser;
  if (!sessionId || ticketUserId !== sessionUser?.id) return false;

  await Promise.all([
    markStepUpFresh(sessionId),
    markTokenPageMfa(sessionId),
    ...(sessionUser.isSuperAdmin ? [markAdminSessionMfa(sessionId)] : []),
  ]);
  return true;
}
