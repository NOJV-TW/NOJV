import { redirect, type Handle, type HandleServerError } from "@sveltejs/kit";
import type { SessionUser } from "@nojv/core";
import { examDomain } from "@nojv/domain";

import { getAuth } from "$lib/auth";
import { createLogger } from "$lib/server/logger";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import { getPageLockedContext, type PageLockedContext } from "$lib/server/page-lock";
import {
  getActiveExamContext,
  isAllowedPathForExam,
  type ActiveExamContext
} from "$lib/server/exam-lock";
import { getWebEnv } from "$lib/server/env";
import { classifyError } from "$lib/server/shared/handle-action-error";

// Validate environment variables eagerly on startup.
getWebEnv();

const processLogger = createLogger("process");
const errorLogger = createLogger("handle-error");
const examLockLogger = createLogger("exam-lock");

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

// Exams are identified by id (no slug) and live under a course route.
// Phase 3 will build the dedicated `/courses/[courseId]/exams/[examId]`
// page; for now the page lock just redirects to that path and allows
// traffic that is already on it or is hitting a problem with an
// `exam=<id>` query param.
function isExamAllowed(
  pathname: string,
  searchParams: URLSearchParams,
  ctx: PageLockedContext
): boolean {
  if (pathname.includes(`/exams/${ctx.examId}`)) return true;
  if (pathname.startsWith("/problems/") && searchParams.get("exam") === ctx.examId) return true;
  return false;
}

async function getCachedPageLockContext(userId: string): Promise<PageLockedContext | null> {
  const now = Date.now();
  const cached = pageLockCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.context;

  const context = await getPageLockedContext(userId);

  // Bounded FIFO / LRU-on-write eviction. Map iterates in insertion order,
  // so the first key is the oldest insertion. Deleting the existing entry
  // for this user first (if any) re-promotes them to the tail on set,
  // giving a proper LRU behavior for actively-refreshing users. Without
  // this, the old cleanup logic was unbounded: it only removed EXPIRED
  // entries when size > MAX, so 10k+ concurrent fresh users with a 30s
  // TTL would grow the map indefinitely and make every miss O(N).
  pageLockCache.delete(userId);
  if (pageLockCache.size >= PAGE_LOCK_CACHE_MAX) {
    const oldestKey = pageLockCache.keys().next().value;
    if (oldestKey != null) pageLockCache.delete(oldestKey);
  }
  pageLockCache.set(userId, { context, expiresAt: now + PAGE_LOCK_CACHE_TTL });

  return context;
}

/**
 * In-memory cache for the exam session lock. Mirrors `pageLockCache`
 * (30s TTL, bounded FIFO/LRU). Reading `ActiveExamSession` on every
 * request is too expensive; a student cannot enter a new exam inside
 * a 30-second window, so stale "no exam" entries are harmless and
 * stale "in exam" entries just delay a freshly-released user from
 * leaving the exam by at most one TTL.
 */
const examContextCache = new Map<
  string,
  { context: ActiveExamContext | null; expiresAt: number }
>();
const EXAM_CONTEXT_CACHE_TTL = 30_000;
const EXAM_CONTEXT_CACHE_MAX = 10_000;

async function getCachedActiveExamContext(userId: string): Promise<ActiveExamContext | null> {
  const now = Date.now();
  const cached = examContextCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.context;

  const context = await getActiveExamContext(userId);

  examContextCache.delete(userId);
  if (examContextCache.size >= EXAM_CONTEXT_CACHE_MAX) {
    const oldestKey = examContextCache.keys().next().value;
    if (oldestKey != null) examContextCache.delete(oldestKey);
  }
  examContextCache.set(userId, { context, expiresAt: now + EXAM_CONTEXT_CACHE_TTL });

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
  // better-auth already infers session.user from the auth config (additional
  // fields + username plugin), so the value is trustworthy. The only gap vs.
  // SessionUser is that platformRole is widened to `string` and username may
  // be `undefined`; cast to reconcile without re-validating.
  event.locals.sessionUser = (session?.user ?? null) as SessionUser | null;

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
      if (lockCtx && !isExamAllowed(cleanPath, event.url.searchParams, lockCtx)) {
        redirect(302, `/exams/${lockCtx.examId}`);
      }
    }
  }

  // Exam session lock (Phase 4 §4.7 State B): once a student has an
  // active exam session, every non-exam navigation bounces back to the
  // exam's first problem page and is logged as a `visibility_lost`
  // event. Must run after session fetch but before the paraglide
  // middleware so the redirect target is a base-locale path.
  //
  // Failure mode: if the DB lookup throws (outage, stale cache, etc.),
  // log and fail open — the student must not be blocked from the site
  // because the lock subsystem is degraded.
  if (event.locals.sessionUser) {
    const sessionUser = event.locals.sessionUser;
    let examCtx: ActiveExamContext | null = null;
    try {
      examCtx = await getCachedActiveExamContext(sessionUser.id);
    } catch (err) {
      examLockLogger.warn("getActiveExamContext failed — failing open", {
        userId: sessionUser.id,
        err: err instanceof Error ? err.message : String(err)
      });
    }

    if (examCtx && !isAllowedPathForExam(cleanPath, examCtx)) {
      try {
        await examDomain.session.recordEvent(
          {
            displayName: sessionUser.name,
            email: sessionUser.email,
            username: sessionUser.username ?? "",
            platformRole: sessionUser.platformRole,
            userId: sessionUser.id
          },
          {
            examId: examCtx.exam.id,
            eventType: "visibility_lost",
            metadata: { attemptedPath: cleanPath }
          }
        );
      } catch (err) {
        examLockLogger.warn("recordEvent(visibility_lost) failed", {
          userId: sessionUser.id,
          examId: examCtx.exam.id,
          err: err instanceof Error ? err.message : String(err)
        });
      }
      redirect(307, `/courses/${examCtx.course.id}/exams/${examCtx.exam.id}/problems/0`);
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

/**
 * Global error hook for UNEXPECTED server-side errors.
 *
 * SvelteKit invokes this only when a load / render / endpoint path throws
 * something other than a redirect or a `error(status, message)` call. For
 * EXPECTED domain errors (404/403/422), load functions should be wrapped
 * with `handleLoad` from `$lib/server/shared/load-wrapper`, which maps
 * `HttpError` subclasses to `error(status, message)` before they reach
 * this hook.
 *
 * This hook's job is therefore:
 *   1. Log the unexpected error with enough context to debug.
 *   2. Return a user-safe `App.Error` body that never leaks internals.
 *
 * It must never throw.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const classified = classifyError(error);

  // Redirects and SvelteKit's own errors short-circuit before reaching this
  // hook, so anything classified as "http" here is a domain HttpError that
  // escaped a load function without being wrapped by `handleLoad`. Surface
  // the real message in that case — it's already safe by construction.
  if (classified.type === "http") {
    errorLogger.warn("Unwrapped domain HttpError reached handleError", {
      method: event.request.method,
      status: classified.status,
      url: event.url.pathname
    });
    return { message: classified.message };
  }

  errorLogger.error("Unhandled server error", {
    err: error instanceof Error ? error.message : String(error),
    method: event.request.method,
    stack: error instanceof Error ? error.stack : undefined,
    status,
    url: event.url.pathname
  });

  return { message };
};
