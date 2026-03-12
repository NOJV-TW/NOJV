import type { Handle } from "@sveltejs/kit";

import { auth } from "$lib/auth";
import { paraglideMiddleware } from "$lib/paraglide/server.js";

export const handle: Handle = async ({ event, resolve }) => {
  // --- Auth: populate event.locals with session/user ---
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  return paraglideMiddleware(event.request, ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    return resolve(event);
  });
};
