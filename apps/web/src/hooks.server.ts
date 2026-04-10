import { redirect, type Handle } from "@sveltejs/kit";
import { sessionUserSchema } from "@nojv/core";

import { getAuth } from "$lib/auth";
import { createLogger } from "$lib/server/logger";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import { getPageLockedContext, type PageLockedContext } from "$lib/server/page-lock";
import { getWebEnv } from "$lib/server/env";

// Validate environment variables eagerly on startup.
getWebEnv();

const processLogger = createLogger("process");

process.on("unhandledRejection", (reason) => {
  processLogger.warn("Unhandled promise rejection", {
    err: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

process.on("uncaughtException", (err) => {
  processLogger.error("Uncaught exception — exiting", {
    err: err.message,
    stack: err.stack
  });
  process.exit(1);
});

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

/** In-memory cache for page lock checks (30s TTL per user, max 10k entries). */
const pageLockCache = new Map<
  string,
  { context: PageLockedContext | null; expiresAt: number }
>();
const PAGE_LOCK_CACHE_TTL = 30_000;
const PAGE_LOCK_CACHE_MAX = 10_000;

function isPageLockExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/signin") ||
    pathname.startsWith("/signup")
  );
}

// CSP is not set here — the inline theme bootstrap in app.html would need a
// nonce (requires `app_template_contains_nonce` in svelte.config.js).
function setSecurityHeaders(response: Response): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function isContestAllowed(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: PageLockedContext
): boolean {
  if (pathname.startsWith(`/contests/${ctx.contestSlug}`)) return true;
  if (pathname.startsWith("/problems/") && searchParams.get("contest") === ctx.contestSlug)
    return true;
  return false;
}

async function getCachedPageLockContext(userId: string): Promise<PageLockedContext | null> {
  const now = Date.now();
  const cached = pageLockCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.context;

  const context = await getPageLockedContext(userId);
  pageLockCache.set(userId, { context, expiresAt: now + PAGE_LOCK_CACHE_TTL });

  if (pageLockCache.size > PAGE_LOCK_CACHE_MAX) {
    for (const [key, entry] of pageLockCache) {
      if (entry.expiresAt <= now) pageLockCache.delete(key);
    }
  }

  return context;
}

export const handle: Handle = async ({ event, resolve }) => {
  const cleanPath = stripLocalePrefix(event.url.pathname);

  if (
    cleanPath.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.request.method)
  ) {
    const origin = event.request.headers.get("origin");
    if (origin && origin !== event.url.origin) {
      return new Response("CSRF validation failed", { status: 403 });
    }
  }

  // Let better-auth own the callback/sign-in flow without additional middleware.
  if (cleanPath.startsWith("/api/auth")) {
    return resolve(event);
  }

  const session = await getAuth().api.getSession({
    headers: event.request.headers
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  const parsed = sessionUserSchema.safeParse(session?.user ?? null);
  event.locals.sessionUser = parsed.success ? parsed.data : null;

  if (event.locals.sessionUser?.disabled) {
    event.locals.session = null;
    event.locals.user = null;
    event.locals.sessionUser = null;
    if (!cleanPath.startsWith("/signin") && !cleanPath.startsWith("/signup")) {
      redirect(302, "/signin?error=account-disabled");
    }
  }

  if (
    event.locals.sessionUser &&
    !event.locals.sessionUser.username &&
    !isProfileExempt(cleanPath)
  ) {
    redirect(302, "/complete-profile");
  }

  if (event.locals.sessionUser) {
    if (!isPageLockExempt(cleanPath)) {
      const lockCtx = await getCachedPageLockContext(event.locals.sessionUser.id);
      if (lockCtx && !isContestAllowed(cleanPath, event.url.searchParams, lockCtx)) {
        redirect(302, `/contests/${lockCtx.contestSlug}`);
      }
    }
  }

  return paraglideMiddleware(event.request, async ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    const response = await resolve(event);
    setSecurityHeaders(response);
    return response;
  });
};
