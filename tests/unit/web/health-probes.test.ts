import type { RequestEvent } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiRequestRecord,
  checkWebReadiness,
  findApiTokenRouteRule,
  getAuth,
  healthProbeRecord,
  authRateLimitConsume,
  signInRateLimitConsume,
  verifyApiTokenForRoute,
} = vi.hoisted(() => ({
  apiRequestRecord: vi.fn(),
  checkWebReadiness: vi.fn(),
  findApiTokenRouteRule: vi.fn(),
  getAuth: vi.fn(),
  healthProbeRecord: vi.fn(),
  authRateLimitConsume: vi.fn(),
  signInRateLimitConsume: vi.fn(),
  verifyApiTokenForRoute: vi.fn(),
}));

vi.mock("$lib/server/otel", () => ({}));
vi.mock("$lib/server/domain-orchestration", () => ({}));
vi.mock("$lib/server/mailer-startup", () => ({}));
vi.mock("$lib/auth.server", () => ({ getAuth }));
vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({ NODE_ENV: "test" }),
}));
vi.mock("$lib/server/shared/rate-limiter", () => ({
  authRateLimiter: { consume: authRateLimitConsume },
  signInRateLimiter: { consume: signInRateLimitConsume },
}));
vi.mock("$lib/paraglide/server.js", () => ({
  paraglideMiddleware: vi.fn(() => {
    throw new Error("paraglide must not run for health probes");
  }),
}));
vi.mock("$lib/server/metrics", () => ({
  apiRequestDuration: { record: apiRequestRecord },
  healthProbeDuration: { record: healthProbeRecord },
  statusClass: (status: number) => `${String(Math.floor(status / 100))}xx`,
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
const healthz = await import("../../../apps/web/src/routes/api/healthz/+server");
const { handle } = await import("../../../apps/web/src/hooks.server");

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
  signInRateLimitConsume.mockReset().mockRejectedValue(new Error("sign-in limiter called"));
  verifyApiTokenForRoute.mockReset().mockRejectedValue(new Error("token auth called"));
});

describe("web health endpoint contracts", () => {
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

    const health = await healthz.GET({} as RequestEvent);
    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toEqual({ ok: false });
    expect(checkWebReadiness).toHaveBeenCalledTimes(2);
    expect(health.headers.get("cache-control")).toBe("no-store");
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
    const second = healthz.GET({} as RequestEvent);
    expect(checkWebReadiness).toHaveBeenCalledOnce();

    finishProbe(true);
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(second).resolves.toMatchObject({ status: 200 });

    await readyz.GET({} as RequestEvent);
    expect(checkWebReadiness).toHaveBeenCalledOnce();
  });
});

describe("health probe hook boundary", () => {
  it.each([
    ["live", "/api/livez", livez],
    ["ready", "/api/readyz", readyz],
    ["health", "/api/healthz", healthz],
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
