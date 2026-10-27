import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { handleLoad } from "#lib/server/shared/load-wrapper.js";

const {
  apiRequestRecord,
  checkWebReadiness,
  findApiTokenRouteRule,
  getAuth,
  healthProbeRecord,
  loggerError,
  authRateLimitConsume,
  signInRateLimitConsume,
  verifyApiTokenForRoute,
} = vi.hoisted(() => ({
  apiRequestRecord: vi.fn(),
  checkWebReadiness: vi.fn(),
  findApiTokenRouteRule: vi.fn(),
  getAuth: vi.fn(),
  healthProbeRecord: vi.fn(),
  loggerError: vi.fn(),
  authRateLimitConsume: vi.fn(),
  signInRateLimitConsume: vi.fn(),
  verifyApiTokenForRoute: vi.fn(),
}));

vi.mock("#lib/server/otel.js", () => ({}));
vi.mock("#lib/server/domain-orchestration.js", () => ({}));
vi.mock("#lib/server/mailer-startup.js", () => ({}));
vi.mock("#lib/server/logger.js", () => ({
  createLogger: () => ({ error: loggerError, warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("#lib/auth.server.js", () => ({ getAuth }));
vi.mock("#lib/server/env.js", () => ({
  getWebEnv: () => ({ NODE_ENV: "test" }),
}));
vi.mock("#lib/server/shared/rate-limiter.js", () => ({
  authRateLimiter: { consume: authRateLimitConsume },
  signInRateLimiter: { consume: signInRateLimitConsume },
}));
vi.mock("#lib/paraglide/server.js", () => ({
  paraglideMiddleware: vi.fn(() => {
    throw new Error("paraglide must not run for health probes");
  }),
}));
vi.mock("#lib/server/metrics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#lib/server/metrics.js")>()),
  apiRequestDuration: { record: apiRequestRecord },
  healthProbeDuration: { record: healthProbeRecord },
}));
vi.mock("@nojv/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nojv/application")>();
  return {
    ...actual,
    adminDomain: { ...actual.adminDomain, checkWebReadiness },
    apiTokenDomain: {
      ...actual.apiTokenDomain,
      findApiTokenRouteRule,
      verifyApiTokenForRoute,
    },
  };
});

const livez = await import("../../../apps/web/src/routes/api/livez/+server");
const readyz = await import("../../../apps/web/src/routes/api/readyz/+server");
const release = await import("../../../apps/web/src/routes/api/release/+server");
const { handle, handleError } = await import("../../../apps/web/src/hooks.server");

let testTime = Date.parse("2026-07-14T00:00:00.000Z");

function routeEvent(pathname: string): RequestEvent {
  const url = new URL(pathname, "http://localhost:5173");
  return {
    request: new Request(url, {
      headers: {
        authorization: "Bearer ignored-by-health-probes",
        cookie: "better-auth.session_token=ignored",
        "x-request-id": "probe-request-id",
      },
    }),
    url,
    locals: {},
    route: { id: pathname },
    getClientAddress: () => "127.0.0.1",
  } as unknown as RequestEvent;
}

async function callRoute(
  module: { GET: (event: RequestEvent) => Promise<Response> },
  pathname: string,
): Promise<Response> {
  const event = routeEvent(pathname);
  return handle({
    event,
    resolve: (resolvedEvent) => module.GET(resolvedEvent),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NOJV_RELEASE_VERSION", "v1.2.3");
  vi.stubEnv("NOJV_RELEASE_SOURCE_SHA", "a".repeat(40));
  testTime += 60_000;
  vi.setSystemTime(testTime);
  apiRequestRecord.mockReset();
  authRateLimitConsume.mockReset().mockRejectedValue(new Error("auth limiter called"));
  checkWebReadiness.mockReset();
  findApiTokenRouteRule.mockReset();
  getAuth.mockReset().mockImplementation(() => {
    throw new Error("getSession called");
  });
  healthProbeRecord.mockReset();
  loggerError.mockReset();
  signInRateLimitConsume.mockReset().mockRejectedValue(new Error("sign-in limiter called"));
  verifyApiTokenForRoute.mockReset().mockRejectedValue(new Error("token auth called"));
});

describe("unexpected server errors", () => {
  it.each(["app", "framework"] as const)("preserves safe %s errors", async (kind) => {
    const error = { status: 403, message: "Access denied" };
    expect(await handleError({ kind, error, event: routeEvent("/private") })).toEqual(error);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("logs persisted-data validation failures without exposing schema details", async () => {
    const event = routeEvent("/submissions/private-id");
    event.locals.requestId = "failed-load-request";
    const parsed = z.enum(["cpp", "python"]).safeParse("private persisted value");
    if (parsed.success) throw new Error("Expected invalid persisted data");
    const load = handleLoad(async () => {
      throw parsed.error;
    });

    await expect(load(event)).rejects.toBe(parsed.error);
    const result = await handleError({
      error: parsed.error,
      event,
      kind: "unknown",
    });

    expect(result).toEqual({ message: "Internal server error." });
    expect(loggerError).toHaveBeenCalledExactlyOnceWith("Request failed", {
      err: parsed.error,
      method: "GET",
      requestId: "failed-load-request",
      status: 500,
      url: "/submissions/private-id",
    });
  });
});

describe("web health endpoint contracts", () => {
  it("reports the immutable release identity without cache or dependency checks", async () => {
    const response = await release.GET({} as RequestEvent);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: "v1.2.3",
      sourceSha: "a".repeat(40),
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(checkWebReadiness).not.toHaveBeenCalled();
  });

  it("keeps liveness dependency-free and non-cacheable", async () => {
    const response = await livez.GET({} as RequestEvent);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ alive: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(checkWebReadiness).not.toHaveBeenCalled();
  });

  it("gates readiness on PostgreSQL and Redis while keeping public bodies minimal", async () => {
    checkWebReadiness.mockResolvedValueOnce(true);

    const ready = await readyz.GET({} as RequestEvent);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ ready: true });

    vi.advanceTimersByTime(5_001);
    checkWebReadiness.mockResolvedValueOnce(false);
    const unavailable = await readyz.GET({} as RequestEvent);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ ready: false });

    expect(checkWebReadiness).toHaveBeenCalledTimes(2);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });

  it("does not serve stale readiness on unexpected probe errors", async () => {
    checkWebReadiness.mockRejectedValueOnce(new Error("unexpected probe failure"));
    await expect(readyz.GET({} as RequestEvent)).rejects.toThrow("unexpected probe failure");
  });

  it("shares a five-second cache and one in-flight dependency probe", async () => {
    let finishProbe!: (value: boolean) => void;
    const pendingProbe = new Promise<boolean>((resolve) => {
      finishProbe = resolve;
    });
    checkWebReadiness.mockReturnValueOnce(pendingProbe);
    vi.advanceTimersByTime(5_001);

    const first = readyz.GET({} as RequestEvent);
    const second = readyz.GET({} as RequestEvent);
    expect(checkWebReadiness).toHaveBeenCalledOnce();

    finishProbe(true);
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });

    await readyz.GET({} as RequestEvent);
    expect(checkWebReadiness).toHaveBeenCalledOnce();
  });
});

describe("health probe hook boundary", () => {
  it("bypasses auth/session for the exact release identity path", async () => {
    const response = await callRoute(release, "/api/release");

    expect(response.headers.get("x-request-id")).toBe("probe-request-id");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(getAuth).not.toHaveBeenCalled();
    expect(findApiTokenRouteRule).not.toHaveBeenCalled();
    expect(verifyApiTokenForRoute).not.toHaveBeenCalled();
    expect(authRateLimitConsume).not.toHaveBeenCalled();
    expect(signInRateLimitConsume).not.toHaveBeenCalled();
    expect(apiRequestRecord).not.toHaveBeenCalled();
    expect(healthProbeRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["live", "/api/livez", livez],
    ["ready", "/api/readyz", readyz],
  ] as const)(
    "bypasses auth/session for the exact %s probe path",
    async (probe, path, route) => {
      checkWebReadiness.mockResolvedValue(true);
      vi.advanceTimersByTime(5_001);

      const response = await callRoute(route, path);

      expect(response.headers.get("x-request-id")).toBe("probe-request-id");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(getAuth).not.toHaveBeenCalled();
      expect(findApiTokenRouteRule).not.toHaveBeenCalled();
      expect(verifyApiTokenForRoute).not.toHaveBeenCalled();
      expect(authRateLimitConsume).not.toHaveBeenCalled();
      expect(signInRateLimitConsume).not.toHaveBeenCalled();
      expect(apiRequestRecord).not.toHaveBeenCalled();
      expect(healthProbeRecord).toHaveBeenCalledWith(expect.any(Number), {
        probe,
        result: "success",
      });
    },
  );

  it("does not broaden the bypass to a similar path", async () => {
    const event = routeEvent("/api/readyz/extra");
    event.request = new Request(event.url, {
      headers: {
        cookie: "better-auth.session_token=not-a-probe",
        "x-request-id": "probe-request-id",
      },
    });
    await expect(
      handle({ event, resolve: () => Promise.resolve(new Response(null, { status: 404 })) }),
    ).rejects.toThrow("getSession called");
    expect(getAuth).toHaveBeenCalledOnce();
  });

  it("records not-ready as a fixed failure label without polluting API SLO metrics", async () => {
    checkWebReadiness.mockResolvedValue(false);
    vi.advanceTimersByTime(5_001);

    const response = await callRoute(readyz, "/api/readyz");

    expect(response.status).toBe(503);
    expect(healthProbeRecord).toHaveBeenCalledWith(expect.any(Number), {
      probe: "ready",
      result: "failure",
    });
    expect(apiRequestRecord).not.toHaveBeenCalled();
  });
});

describe("ambiguous request path guard", () => {
  it.each(["GET", "POST"])(
    "rejects %s double-slash paths before auth or route resolution",
    async (method) => {
      const event = routeEvent("http://localhost:5173//attacker.example/login");
      event.request = new Request(event.url, { method });
      const resolve = vi.fn().mockResolvedValue(new Response("resolved"));

      const response = await handle({ event, resolve });

      expect(event.url.origin).toBe("http://localhost:5173");
      expect(event.url.pathname).toBe("//attacker.example/login");
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(getAuth).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    },
  );
});
