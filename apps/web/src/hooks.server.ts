import "$lib/server/otel"; // Must stay first for auto-instrumentation.
import "$lib/server/domain-orchestration";
import "$lib/server/mailer-startup";

import { error, redirect, type Handle, type HandleServerError } from "@sveltejs/kit";
import type { SessionUser } from "@nojv/core";
import {
  apiTokenDomain,
  examDomain,
  getPageLockedContext,
  proctoringDomain,
  type PageLockedContext,
} from "@nojv/application";

import { getAuth } from "$lib/auth.server";
import { examContextCache, pageLockCache } from "$lib/server/exam-context-cache";
import { createLogger } from "$lib/server/logger";
import { m } from "$lib/paraglide/messages.js";
import { paraglideMiddleware } from "$lib/paraglide/server.js";
import {
  getActiveExamContext,
  isAllowedPathForExam,
  isExamForbiddenApiRequest,
  resolveExamGateDenial,
  type ActiveExamContext,
} from "$lib/server/exam-lock";
import { getWebEnv } from "$lib/server/env";
import { healthProbeKind } from "$lib/server/health-probes";
import { consumeStepUpHandoff } from "$lib/server/step-up-handoff";
import {
  adminElevationPrincipal,
  isSuperAdminSessionExpired,
  resolveAdminElevation,
  revokeAdminElevation,
} from "$lib/server/step-up";
import {
  apiRequestDuration,
  healthProbeDuration,
  statusClass,
  type ApiRequestLabels,
  type HealthProbeLabels,
} from "$lib/server/metrics";
import { classifyError } from "$lib/server/shared/handle-action-error";
import { getClientIp } from "$lib/server/shared/client-ip";
import {
  authRateLimiter,
  signInRateLimiter,
  type RateLimitResult,
} from "$lib/server/shared/rate-limiter";
import {
  deriveRequestId,
  enforceCsrf,
  setSecurityHeaders,
} from "$lib/server/hooks/request-security";
import {
  isPageLockExempt,
  isProfileExempt,
  stripLocalePrefix,
} from "$lib/server/hooks/route-paths";

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

export const handle: Handle = async ({ event, resolve }) => {
  const startMs = performance.now();
  const probe = healthProbeKind(event.url.pathname);
  let recordedStatus: number | null = null;
  try {
    const response = await runHandle({ event, resolve });
    setSecurityHeaders(response);
    recordedStatus = response.status;
    return response;
  } finally {
    const routeId = event.route.id ?? "unmatched";
    if (probe) {
      healthProbeDuration.record((performance.now() - startMs) / 1000, {
        probe,
        result:
          recordedStatus !== null && recordedStatus >= 200 && recordedStatus < 300
            ? "success"
            : "failure",
      } satisfies HealthProbeLabels);
    } else if (!routeId.endsWith("/stream")) {
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

function jsonErrorResponse(opts: {
  code?: string;
  message: string;
  requestId: string;
  status: number;
}): Response {
  return new Response(JSON.stringify({ message: opts.message, code: opts.code }), {
    status: opts.status,
    headers: {
      "content-type": "application/json",
      "x-request-id": opts.requestId,
    },
  });
}

function readBearerToken(event: HandleEvent): string | null {
  const authorization = event.request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

async function authenticateApiToken(
  event: HandleEvent,
  cleanPath: string,
): Promise<Response | null> {
  event.locals.apiToken = null;
  event.locals.apiTokenActor = null;

  const token = readBearerToken(event);
  if (!token) return null;

  const route = apiTokenDomain.findApiTokenRouteRule(event.request.method, cleanPath);
  if (!route) {
    return jsonErrorResponse({
      code: "api_token_route_not_allowed",
      message: "API token auth is not allowed for this endpoint.",
      requestId: event.locals.requestId,
      status: 403,
    });
  }

  try {
    const verified = await apiTokenDomain.verifyApiTokenForRoute({
      ip: getClientIp(event),
      route,
      token,
    });
    event.locals.apiToken = verified;
    event.locals.apiTokenActor = verified.actor;
  } catch (err) {
    const classified = classifyError(err);
    return jsonErrorResponse({
      message: classified.message,
      requestId: event.locals.requestId,
      status: classified.status,
    });
  }

  return null;
}

async function handleApiAuthRoute(
  event: HandleEvent,
  cleanPath: string,
  resolve: HandleResolve,
): Promise<Response | null> {
  if (cleanPath !== "/api/auth" && !cleanPath.startsWith("/api/auth/")) {
    return null;
  }

  const ip = getClientIp(event);
  const authRateLimit = await authRateLimiter.consume(ip);
  const authRateLimitResponse = blockedAuthRateLimitResponse(
    authRateLimit,
    event.locals.requestId,
  );
  if (authRateLimitResponse) return authRateLimitResponse;

  const isPasswordSignIn =
    event.request.method === "POST" &&
    (cleanPath === "/api/auth/sign-in/email" || cleanPath === "/api/auth/sign-in/username");
  if (isPasswordSignIn) {
    const rateLimit = await signInRateLimiter.consume(ip);
    const signInRateLimitResponse = blockedAuthRateLimitResponse(
      rateLimit,
      event.locals.requestId,
      "Too many sign-in attempts. Try again later.",
    );
    if (signInRateLimitResponse) return signInRateLimitResponse;
  }
  const response = await resolve(event);
  response.headers.set("x-request-id", event.locals.requestId);
  return response;
}

function blockedAuthRateLimitResponse(
  result: RateLimitResult,
  requestId: string,
  limitedMessage = "Too many authentication requests. Try again later.",
): Response | null {
  if (result === "allowed") return null;
  const unavailable = result === "unavailable";
  return new Response(
    JSON.stringify({
      message: unavailable ? "Authentication rate limiter unavailable." : limitedMessage,
    }),
    {
      status: unavailable ? 503 : 429,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    },
  );
}

async function loadSession(event: HandleEvent): Promise<void> {
  const session = await getAuth().api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;
  event.locals.sessionUser = (session?.user ?? null) as SessionUser | null;
}

async function enforceAccountState(event: HandleEvent, cleanPath: string): Promise<void> {
  if (event.locals.sessionUser?.disabled) {
    const sessionId = event.locals.session?.id;
    if (sessionId) {
      await revokeAdminElevation(sessionId);
    }
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

async function resolveAdminMode(event: HandleEvent): Promise<void> {
  const user = event.locals.sessionUser;
  const sessionId = event.locals.session?.id;
  event.locals.adminModeActive =
    user?.platformRole === "admin" &&
    !!sessionId &&
    (await resolveAdminElevation(sessionId, adminElevationPrincipal(user)));
}

async function enforceSuperAdminSessionAge(event: HandleEvent): Promise<Response | null> {
  const user = event.locals.sessionUser;
  const session = event.locals.session;
  if (!user?.isSuperAdmin || !session) {
    return null;
  }
  if (!isSuperAdminSessionExpired(new Date(session.createdAt))) {
    return null;
  }
  const { headers } = await getAuth().api.signOut({
    headers: event.request.headers,
    returnHeaders: true,
  });
  event.locals.session = null;
  event.locals.user = null;
  event.locals.sessionUser = null;
  headers.set("location", "/signin?error=session-expired");
  return new Response(null, { status: 302, headers });
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

  let examCtx: ActiveExamContext | null;
  try {
    examCtx = await examContextCache.getOrLoad(sessionUser.id, () =>
      getActiveExamContext(sessionUser.id),
    );
  } catch (err) {
    examLockLogger.error("getActiveExamContext failed — failing closed", {
      userId: sessionUser.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return denyExamGate({
      cleanPath,
      requestId: event.locals.requestId,
      status: 503,
      message: m.examShell_ipGateUnavailable(),
      code: "exam_context_unavailable",
    });
  }

  if (!examCtx) {
    return null;
  }

  const ip = getClientIp(event);
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

  event.locals.examGate = { entityId: examCtx.exam.id, verdict };

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

  if (isExamForbiddenApiRequest(cleanPath, event.request.method)) {
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
  event.locals.apiToken = null;
  event.locals.apiTokenActor = null;
  event.locals.adminModeActive = false;
  event.locals.examGate = null;

  if (healthProbeKind(event.url.pathname)) {
    const response = await resolve(event);
    response.headers.set("x-request-id", event.locals.requestId);
    return response;
  }

  const cleanPath = stripLocalePrefix(event.url.pathname);

  const apiTokenAuthResponse = await authenticateApiToken(event, cleanPath);
  if (apiTokenAuthResponse) {
    return apiTokenAuthResponse;
  }

  const csrfResponse = enforceCsrf(event, cleanPath);
  if (csrfResponse) {
    return csrfResponse;
  }

  const authResponse = await handleApiAuthRoute(event, cleanPath, resolve);
  if (authResponse) {
    return authResponse;
  }

  await loadSession(event);
  await consumeStepUpHandoff(event);
  await enforceAccountState(event, cleanPath);
  const expiredSessionResponse = await enforceSuperAdminSessionAge(event);
  if (expiredSessionResponse) {
    return expiredSessionResponse;
  }
  enforcePasswordChange(event, cleanPath);
  await resolveAdminMode(event);
  await enforcePageLock(event, cleanPath);

  const examResponse = await enforceExamGate(event, cleanPath);
  if (examResponse) {
    return examResponse;
  }

  return paraglideMiddleware(event.request, async ({ request, locale }) => {
    event.request = request;
    const response = await resolve(event, {
      transformPageChunk: ({ html }) => html.replace("%paraglide.lang%", locale),
    });
    if (event.locals.apiToken && response.status < 400) {
      await apiTokenDomain.recordApiTokenUse({
        ip: event.locals.apiToken.ip,
        tokenId: event.locals.apiToken.tokenId,
      });
    }
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

  if (status < 500) {
    errorLogger.warn("Client error", {
      err: error instanceof Error ? error.message : String(error),
      method: event.request.method,
      requestId,
      status,
      url: event.url.pathname,
    });
    return { message };
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
