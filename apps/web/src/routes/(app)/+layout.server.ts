import { redirect } from "@sveltejs/kit";

import { getActorContext, hasActorHandle } from "$lib/server/auth";
import { parseSessionUser } from "$lib/session";

import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = (event) => {
  const session = event.locals.session;
  if (!session) {
    redirect(303, "/signin");
  }

  const actor = getActorContext(event);
  if (actor && !hasActorHandle(actor)) {
    redirect(302, "/complete-profile");
  }

  return { user: parseSessionUser(event.locals.user) };
};
