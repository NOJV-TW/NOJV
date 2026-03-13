import { redirect, type Handle } from "@sveltejs/kit";
import { sessionUserSchema } from "@nojv/core";

import { auth } from "$lib/auth";
import { paraglideMiddleware } from "$lib/paraglide/server.js";

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
  const parsed = sessionUserSchema.safeParse(session?.user ?? null);
  event.locals.sessionUser = parsed.success ? parsed.data : null;

  // --- Guard: block disabled users ---
  if (event.locals.sessionUser?.disabled) {
    event.locals.session = null;
    event.locals.user = null;
    event.locals.sessionUser = null;
    const clean = stripLocalePrefix(event.url.pathname);
    if (!clean.startsWith("/signin") && !clean.startsWith("/signup")) {
      redirect(302, "/signin?error=account-disabled");
    }
  }

  // --- Guard: redirect users without a handle to /complete-profile ---
  if (event.locals.sessionUser && !event.locals.sessionUser.handle && !isProfileExempt(event.url.pathname)) {
    redirect(302, "/complete-profile");
  }

  return paraglideMiddleware(event.request, ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    return resolve(event);
  });
};
