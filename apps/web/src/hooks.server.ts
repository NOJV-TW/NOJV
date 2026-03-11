import type { Handle } from "@sveltejs/kit";

import { auth } from "$lib/auth";

export const handle: Handle = async ({ event, resolve }) => {
  // --- Auth: populate event.locals with session/user ---
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  return resolve(event);
};
