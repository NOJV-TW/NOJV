import type { Handle } from "@sveltejs/kit";

import { auth } from "$lib/auth";
import { paraglideMiddleware } from "$lib/paraglide/server.js";

export const handle: Handle = async ({ event, resolve }) => {
  // --- Auth: populate event.locals with session/user ---
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- better-auth types depend on Prisma generated client
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- better-auth session type
  event.locals.session = session?.session ?? null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- better-auth user type
  event.locals.user = session?.user ?? null;

  return paraglideMiddleware(event.request, ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    return resolve(event);
  });
};
