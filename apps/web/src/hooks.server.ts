import { redirect, type Handle } from "@sveltejs/kit";
import { sessionUserSchema } from "@nojv/core";

import { getAuth } from "$lib/auth";
import { createLogger } from "$lib/server/logger";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import { getPageLockedContext, type PageLockedContext } from "$lib/server/page-lock";
import { getWebEnv } from "$lib/server/env";

// Validate environment variables eagerly on startup.
getWebEnv();

// --- Process-level error handlers ---
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

/**
 * Baseline security response headers, applied to every response.
 * CSP is intentionally NOT set here — the inline theme bootstrap in
 * `app.html` would need a nonce, which requires `app_template_contains_nonce`
 * in svelte.config.js. Add CSP in a follow-up after auditing third-party
 * scripts and inline handlers.
 */
function setSecurityHeaders(response: Response): void {
  // Disable MIME sniffing — browsers must respect the declared Content-Type.
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Disallow framing entirely (clickjacking protection).
  response.headers.set("X-Frame-Options", "DENY");
  // Limit how much referrer info is sent on cross-origin navigation.
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Deny access to powerful APIs by default; opt in per route if needed.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  // HSTS only when the request is already HTTPS — avoid pinning HTTP-only dev.
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function isContestAllowed(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: PageLockedContext & { type: "contest" }
): boolean {
  // Contest main page, problems, scoreboard
  if (pathname.startsWith(`/contests/${ctx.contestSlug}`)) return true;
  // Problem pages with ?contest=slug
  if (pathname.startsWith("/problems/") && searchParams.get("contest") === ctx.contestSlug)
    return true;
  return false;
}

function isAssessmentAllowed(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: PageLockedContext & { type: "assessment" }
): boolean {
  // Assessment workspace page
  if (pathname.startsWith(`/courses/${ctx.courseSlug}/assignments/${ctx.assessmentSlug}`))
    return true;
  // Problem pages with ?course=slug&assessment=slug
  if (
    pathname.startsWith("/problems/") &&
    searchParams.get("course") === ctx.courseSlug &&
    searchParams.get("assessment") === ctx.assessmentSlug
  )
    return true;
  return false;
}

async function getCachedPageLockContext(userId: string): Promise<PageLockedContext | null> {
  const now = Date.now();
  const cached = pageLockCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.context;

  const context = await getPageLockedContext(userId);
  pageLockCache.set(userId, { context, expiresAt: now + PAGE_LOCK_CACHE_TTL });

  // Evict stale entries when cache grows too large
  if (pageLockCache.size > PAGE_LOCK_CACHE_MAX) {
    for (const [key, entry] of pageLockCache) {
      if (entry.expiresAt <= now) pageLockCache.delete(key);
    }
  }

  return context;
}

export const handle: Handle = async ({ event, resolve }) => {
  const cleanPath = stripLocalePrefix(event.url.pathname);

  // --- CSRF: validate Origin header on mutating API requests ---
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

  // --- Auth: populate event.locals with session/user/sessionUser ---
  const session = await getAuth().api.getSession({
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
    if (!cleanPath.startsWith("/signin") && !cleanPath.startsWith("/signup")) {
      redirect(302, "/signin?error=account-disabled");
    }
  }

  // --- Guard: redirect users without a username to /complete-profile ---
  if (
    event.locals.sessionUser &&
    !event.locals.sessionUser.username &&
    !isProfileExempt(cleanPath)
  ) {
    redirect(302, "/complete-profile");
  }

  // --- Guard: page lock enforcement ---
  if (event.locals.sessionUser) {
    if (!isPageLockExempt(cleanPath)) {
      const lockCtx = await getCachedPageLockContext(event.locals.sessionUser.id);
      if (lockCtx) {
        if (lockCtx.type === "contest") {
          if (!isContestAllowed(cleanPath, event.url.searchParams, lockCtx)) {
            redirect(302, `/contests/${lockCtx.contestSlug}`);
          }
        } else {
          if (!isAssessmentAllowed(cleanPath, event.url.searchParams, lockCtx)) {
            redirect(
              302,
              `/courses/${lockCtx.courseSlug}/assignments/${lockCtx.assessmentSlug}`
            );
          }
        }
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
