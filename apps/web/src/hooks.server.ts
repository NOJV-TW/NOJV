import "$lib/server/otel"; // MUST be first — registers auto-instrumentation hooks before any other import loads pg/ioredis/etc.

import {
  error,
  isHttpError,
  redirect,
  type Handle,
  type HandleServerError,
} from "@sveltejs/kit";
import type { SessionUser } from "@nojv/core";
import {
  examDomain,
  getPageLockedContext,
  proctoringDomain,
  type PageLockedContext,
} from "@nojv/domain";

import { getAuth } from "$lib/auth.server";
import { examContextCache, pageLockCache } from "$lib/server/exam-context-cache";
import { createLogger } from "$lib/server/logger";
import { m } from "$lib/paraglide/messages.js";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import {
  getActiveExamContext,
  isAllowedPathForExam,
  isExamForbiddenApiPath,
  resolveExamGateDenial,
  type ActiveExamContext,
} from "$lib/server/exam-lock";
import { getWebEnv } from "$lib/server/env";
import { apiRequestDuration, statusClass, type ApiRequestLabels } from "$lib/server/metrics";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { getClientIp } from "$lib/server/shared/client-ip";
import { signInRateLimiter } from "$lib/server/shared/rate-limiter";

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

const PROFILE_EXEMPT_PREFIXES = [
  "/api/",
  "/complete-profile",
  "/verify-school",
  "/signin",
  "/admin-signin",
  "/signup",
];

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

function isPageLockExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/signin") ||
    pathname.startsWith("/signup")
  );
}

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
  const prefix = `/exams/${ctx.examId}`;
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function denyExamGate(opts: {
  cleanPath: string;
  requestId: string;
  status: number;
  message: string;
  code: string;
}): Response {
  if (opts.cleanPath.startsWith("/api/")) {
    return new Response(JSON.stringify({ message: opts.message, code: opts.code }), {
      status: opts.status,
      headers: { "content-type": "application/json", "x-request-id": opts.requestId },
    });
  }
  error(opts.status, opts.message);
}

function pageLockRedirectTarget(ctx: PageLockedContext): string {
  return `/exams/${ctx.examId}`;
}

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
    setSecurityHeaders(response);
    recordedStatus = response.status;
    return response;
  } finally {
    const routeId = event.route.id ?? "unmatched";
    if (!routeId.endsWith("/stream")) {
      apiRequestDuration.record((performance.now() - startMs) / 1000, {
        route: routeId,
        method: event.request.method,
        status_class: statusClass(recordedStatus ?? 500),
      } satisfies ApiRequestLabels);
    }
  }
};

type HandleEvent = Parameters<Handle>[0]["event"];
type HandleResolve = Parameters<Handle>[0]["resolve"];

function enforceApiCsrf(event: HandleEvent, cleanPath: string): Response | null {
  if (
    !cleanPath.startsWith("/api/") ||
    ["GET", "HEAD", "OPTIONS"].includes(event.request.method)
  ) {
    return null;
  }

  const origin = event.request.headers.get("origin");
  if (origin && origin !== event.url.origin) {
    return new Response("CSRF validation failed", {
      status: 403,
      headers: { "x-request-id": event.locals.requestId },
    });
  }

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

  return null;
}

async function handleApiAuthRoute(
  event: HandleEvent,
  cleanPath: string,
  resolve: HandleResolve,
): Promise<Response | null> {
  if (!cleanPath.startsWith("/api/auth")) {
    return null;
  }

  const isPasswordSignIn =
    event.request.method === "POST" &&
    (cleanPath === "/api/auth/sign-in/email" || cleanPath === "/api/auth/sign-in/username");
  if (isPasswordSignIn) {
    const ip = getClientIp(event);
    try {
      await signInRateLimiter.consume(ip);
    } catch (err) {
      if (isHttpError(err)) throw err;
      return new Response(
        JSON.stringify({ message: "Too many sign-in attempts. Try again later." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-request-id": event.locals.requestId,
          },
        },
      );
    }
  }
  const response = await resolve(event);
  response.headers.set("x-request-id", event.locals.requestId);
  return response;
}

async function loadSession(event: HandleEvent): Promise<void> {
  const session = await getAuth().api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;
  event.locals.sessionUser = (session?.user ?? null) as SessionUser | null;
}

function enforceAccountState(event: HandleEvent, cleanPath: string): void {
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
}

function enforcePasswordChange(event: HandleEvent, cleanPath: string): void {
  if (
    event.locals.sessionUser?.mustChangePassword &&
    !cleanPath.startsWith("/api/") &&
    !cleanPath.startsWith("/account/change-password") &&
    !cleanPath.startsWith("/complete-profile") &&
    !cleanPath.startsWith("/signin")
  ) {
    redirect(302, "/account/change-password");
  }
}

async function enforcePageLock(event: HandleEvent, cleanPath: string): Promise<void> {
  if (!event.locals.sessionUser || isPageLockExempt(cleanPath)) {
    return;
  }
  const userId = event.locals.sessionUser.id;
  const lockCtx = await pageLockCache.getOrLoad(userId, () => getPageLockedContext(userId));
  if (lockCtx && !isProctoredEntityAllowed(cleanPath, lockCtx)) {
    redirect(302, pageLockRedirectTarget(lockCtx));
  }
}

async function recordExamVisibilityLost(
  sessionUser: NonNullable<HandleEvent["locals"]["sessionUser"]>,
  examCtx: ActiveExamContext,
  cleanPath: string,
): Promise<void> {
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
}

async function enforceExamGate(
  event: HandleEvent,
  cleanPath: string,
): Promise<Response | null> {
  const sessionUser = event.locals.sessionUser;
  if (!sessionUser) {
    return null;
  }

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

  if (!examCtx) {
    return null;
  }

  const ip = getClientIp(event); // prod: throws 403 if the request bypassed Cloudflare
  let verdict;
  try {
    verdict = await proctoringDomain.checkProctoringGate({
      entityKind: "exam",
      entityId: examCtx.exam.id,
      userId: sessionUser.id,
      ip,
    });
  } catch (err) {
    examLockLogger.error("exam proctoring gate failed — failing closed", {
      userId: sessionUser.id,
      examId: examCtx.exam.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return denyExamGate({
      cleanPath,
      requestId: event.locals.requestId,
      status: 503,
      message: m.examShell_ipGateUnavailable(),
      code: "exam_ip_gate_unavailable",
    });
  }

  const denial = resolveExamGateDenial(verdict, cleanPath);
  if (denial) {
    return denyExamGate({
      cleanPath,
      requestId: event.locals.requestId,
      status: denial.status,
      message: denial.scope === "all" ? m.examShell_ipBlocked() : m.examShell_examUnavailable(),
      code: denial.code,
    });
  }

  if (isExamForbiddenApiPath(cleanPath)) {
    return denyExamGate({
      cleanPath,
      requestId: event.locals.requestId,
      status: 403,
      message: m.examShell_examUnavailable(),
      code: "exam_api_scope",
    });
  }

  if (!isAllowedPathForExam(cleanPath, examCtx)) {
    await recordExamVisibilityLost(sessionUser, examCtx, cleanPath);
    redirect(307, `/exams/${examCtx.exam.id}`);
  }

  return null;
}

const runHandle = async ({ event, resolve }: Parameters<Handle>[0]): Promise<Response> => {
  event.locals.requestId = deriveRequestId(event.request.headers);

  const cleanPath = stripLocalePrefix(event.url.pathname);

  const csrfResponse = enforceApiCsrf(event, cleanPath);
  if (csrfResponse) {
    return csrfResponse;
  }

  const authResponse = await handleApiAuthRoute(event, cleanPath, resolve);
  if (authResponse) {
    return authResponse;
  }

  await loadSession(event);
  enforceAccountState(event, cleanPath);
  enforcePasswordChange(event, cleanPath);
  await enforcePageLock(event, cleanPath);

  const examResponse = await enforceExamGate(event, cleanPath);
  if (examResponse) {
    return examResponse;
  }

  return paraglideMiddleware(event.request, async ({ request }) => {
    event.request = request;
    const response = await resolve(event);
    response.headers.set("x-request-id", event.locals.requestId);
    return response;
  });
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const classified = classifyError(error);
  const requestId = event.locals.requestId;

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
