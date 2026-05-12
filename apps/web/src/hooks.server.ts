import "$lib/server/otel"; // MUST be first — registers auto-instrumentation hooks before any other import loads pg/ioredis/etc.

import { redirect, type Handle, type HandleServerError } from "@sveltejs/kit";
import type { SessionUser } from "@nojv/core";
import { examDomain } from "@nojv/domain";

import { getAuth } from "$lib/auth.server";
import { createLogger } from "$lib/server/logger";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import { getPageLockedContext, type PageLockedContext } from "$lib/server/page-lock";
import {
  getActiveExamContext,
  isAllowedPathForExam,
  type ActiveExamContext,
} from "$lib/server/exam-lock";
import { getWebEnv } from "$lib/server/env";
import { apiRequestDuration, statusClass, type ApiRequestLabels } from "$lib/server/metrics";
import { classifyError } from "$lib/server/shared/handle-action-error";

// Validate environment variables eagerly on startup.
getWebEnv();

const processLogger = createLogger("process");
const errorLogger = createLogger("handle-error");
const examLockLogger = createLogger("exam-lock");

process.on("unhandledRejection", (reason) => {
  processLogger.warn("Unhandled promise rejection", {
    err: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (err) => {
  processLogger.error("Uncaught exception — exiting", {
    err: err.message,
    stack: err.stack,
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
  "/signup",
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

/** Bounded FIFO/LRU memoizer for per-user lock lookups: stale entries at
 *  most delay a freshly-released user from leaving the locked surface. */
function createTtlCache<T>(ttlMs: number, maxEntries: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();
  return {
    async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > now) return hit.value;

      const value = await load();

      // Re-inserting on set promotes to the tail; first key is the oldest.
      store.delete(key);
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest != null) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: now + ttlMs });
      return value;
    },
  };
}

const pageLockCache = createTtlCache<PageLockedContext | null>(30_000, 10_000);
const examContextCache = createTtlCache<ActiveExamContext | null>(30_000, 10_000);

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
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function isProctoredEntityAllowed(pathname: string, ctx: PageLockedContext): boolean {
  // Exam solves live under the top-level `/exams/[examId]/...` tree. Contests
  // are public and never page-locked.
  return pathname.includes(`/exams/${ctx.examId}`);
}

function pageLockRedirectTarget(ctx: PageLockedContext): string {
  return `/exams/${ctx.examId}`;
}

/**
 * Reuse an inbound `X-Request-Id` only if it looks safe (printable ASCII,
 * <= 128 chars). Otherwise mint a fresh UUID. This protects logs and
 * downstream systems from header-injected control characters.
 */
function deriveRequestId(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  if (incoming && incoming.length > 0 && incoming.length <= 128 && /^[\w.-]+$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

export const handle: Handle = async ({ event, resolve }) => {
  const startMs = performance.now();
  let recordedStatus: number | null = null;
  try {
    const response = await runHandle({ event, resolve });
    recordedStatus = response.status;
    return response;
  } finally {
    const routeId = event.route.id ?? "unmatched";
    if (!routeId.endsWith("/stream")) {
      // `recordedStatus ?? 500` covers thrown redirect/error paths where the
      // response object never exists in this scope — SvelteKit converts those
      // to 3xx/4xx upstream of `handle`, but we can't observe the final status
      // from `finally`. Imprecision accepted: ~5–10% of dashboard traffic.
      apiRequestDuration.record((performance.now() - startMs) / 1000, {
        route: routeId,
        method: event.request.method,
        status_class: statusClass(recordedStatus ?? 500),
      } satisfies ApiRequestLabels);
    }
  }
};

const runHandle = async ({ event, resolve }: Parameters<Handle>[0]): Promise<Response> => {
  event.locals.requestId = deriveRequestId(event.request.headers);

  const cleanPath = stripLocalePrefix(event.url.pathname);

  if (
    cleanPath.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.request.method)
  ) {
    const origin = event.request.headers.get("origin");
    if (origin && origin !== event.url.origin) {
      return new Response("CSRF validation failed", {
        status: 403,
        headers: { "x-request-id": event.locals.requestId },
      });
    }

    // Require an `X-Requested-With: fetch` header on /api/** mutations.
    // Browsers add this to non-simple cross-origin requests, which forces a
    // CORS preflight that our server will reject (no CORS config). On
    // same-origin calls our own client code adds it explicitly. A classic
    // form-submission CSRF (from <form action> on an attacker page) cannot
    // set custom headers, so it's blocked even when Origin is missing.
    // better-auth lives at /api/auth and is exempt — it has its own CSRF
    // defenses and is hit by external OAuth callbacks.
    if (!cleanPath.startsWith("/api/auth")) {
      const xrw = event.request.headers.get("x-requested-with");
      if (xrw !== "fetch") {
        return new Response(
          JSON.stringify({ message: "CSRF token required", code: "csrf_required" }),
          {
            status: 403,
            headers: {
              "content-type": "application/json",
              "x-request-id": event.locals.requestId,
            },
          },
        );
      }
    }
  }

  // Let better-auth own the callback/sign-in flow without additional middleware.
  if (cleanPath.startsWith("/api/auth")) {
    const response = await resolve(event);
    response.headers.set("x-request-id", event.locals.requestId);
    return response;
  }

  const session = await getAuth().api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;
  // better-auth's inferred session.user is trustworthy; cast narrows `platformRole` / `username` to SessionUser.
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
      const userId = event.locals.sessionUser.id;
      const lockCtx = await pageLockCache.getOrLoad(userId, () => getPageLockedContext(userId));
      if (lockCtx && !isProctoredEntityAllowed(cleanPath, lockCtx)) {
        redirect(302, pageLockRedirectTarget(lockCtx));
      }
    }
  }

  // Fails open on DB error: a degraded lock subsystem must never block the student from the site.
  if (event.locals.sessionUser) {
    const sessionUser = event.locals.sessionUser;
    let examCtx: ActiveExamContext | null = null;
    try {
      examCtx = await examContextCache.getOrLoad(sessionUser.id, () =>
        getActiveExamContext(sessionUser.id),
      );
    } catch (err) {
      examLockLogger.warn("getActiveExamContext failed — failing open", {
        userId: sessionUser.id,
        err: err instanceof Error ? err.message : String(err),
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
            userId: sessionUser.id,
          },
          {
            examId: examCtx.exam.id,
            eventType: "visibility_lost",
            metadata: { attemptedPath: cleanPath },
          },
        );
      } catch (err) {
        examLockLogger.warn("recordEvent(visibility_lost) failed", {
          userId: sessionUser.id,
          examId: examCtx.exam.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      redirect(307, `/exams/${examCtx.exam.id}`);
    }
  }

  return paraglideMiddleware(event.request, async ({ request }) => {
    // Update the event request with the (potentially de-localized) request
    event.request = request;
    const response = await resolve(event);
    setSecurityHeaders(response);
    response.headers.set("x-request-id", event.locals.requestId);
    return response;
  });
};

// Expected domain errors are wrapped by `handleLoad`; anything reaching here is an unexpected throw.
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const classified = classifyError(error);
  const requestId = event.locals.requestId;

  // An "http" classification here is a domain HttpError that escaped an unwrapped load function.
  if (classified.type === "http") {
    errorLogger.warn("Unwrapped domain HttpError reached handleError", {
      method: event.request.method,
      requestId,
      status: classified.status,
      url: event.url.pathname,
    });
    return { message: classified.message };
  }

  errorLogger.error("Unhandled server error", {
    err: error instanceof Error ? error.message : String(error),
    method: event.request.method,
    requestId,
    stack: error instanceof Error ? error.stack : undefined,
    status,
    url: event.url.pathname,
  });

  return { message };
};
