import { redirect, type Handle } from "@sveltejs/kit";

import { auth } from "$lib/auth";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import { parseSessionUser } from "$lib/session";

/** Route prefixes exempt from the complete-profile redirect. */
const PROFILE_EXEMPT_PREFIXES = [
  "/api/",
  "/complete-profile",
  "/verify-school",
  "/signin",
  "/admin-signin",
  "/signup"
];

/** Locale prefixes that paraglide may prepend to URLs (non-base locales). */
const LOCALE_PREFIXES = ["/zh-TW"];

function stripLocalePrefix(pathname: string): string {
  for (const lp of LOCALE_PREFIXES) {
    if (pathname === lp || pathname.startsWith(lp + "/")) {
      return pathname.slice(lp.length) || "/";
    }
  }
  return pathname;
}

function isProfileExempt(pathname: string): boolean {
  const clean = stripLocalePrefix(pathname);
  return PROFILE_EXEMPT_PREFIXES.some((p) => clean.startsWith(p));
}

export const handle: Handle = async ({ event, resolve }) => {
  // --- Auth: populate event.locals with session/user/sessionUser ---
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;
  event.locals.sessionUser = parseSessionUser(session?.user ?? null);

  // --- Guard: redirect users without a handle to /complete-profile ---
  const { sessionUser } = event.locals;
  if (sessionUser && !sessionUser.handle && !isProfileExempt(event.url.pathname)) {
    redirect(302, "/complete-profile");
  }

  return paraglideMiddleware(event.request, ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    return resolve(event);
  });
};
