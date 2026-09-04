import type { RequestHandler } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser } from "../../fixtures/factories";
import { callRoute } from "./_harness";

const { resolveAdminAccessSpy, authConsumeSpy, signInConsumeSpy, signOutSpy } = vi.hoisted(
  () => ({
    resolveAdminAccessSpy: vi.fn(),
    authConsumeSpy: vi.fn(),
    signInConsumeSpy: vi.fn(),
    signOutSpy: vi.fn(),
  }),
);

vi.mock("$lib/server/shared/rate-limiter", () => ({
  authRateLimiter: { consume: authConsumeSpy },
  signInRateLimiter: { consume: signInConsumeSpy },
}));

vi.mock("$lib/server/step-up", async () => {
  const actual =
    await vi.importActual<typeof import("$lib/server/step-up")>("$lib/server/step-up");
  resolveAdminAccessSpy.mockImplementation(actual.resolveAdminAccess);
  return { ...actual, resolveAdminAccess: resolveAdminAccessSpy };
});

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      signOut: signOutSpy,
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma } = await import("../../fixtures/factories");
        const user = await testPrisma.user.findUnique({ where: { id: userId } });
        const createdAt = headers.get("x-test-session-created-at");
        return user
          ? {
              session: {
                id: "test-session",
                userId,
                createdAt: createdAt ? new Date(createdAt) : new Date(),
              },
              user,
            }
          : null;
      },
    },
  }),
}));

vi.mock("$lib/server/env", () => ({
  getWebEnv: () => ({ NODE_ENV: "development" }),
}));

const NO_RESOLVE = {};
const inspectAdminMode: RequestHandler = (event) =>
  new Response(JSON.stringify({ active: event.locals.adminAccessActive }));

beforeEach(() => {
  resolveAdminAccessSpy.mockClear();
  authConsumeSpy.mockReset().mockResolvedValue("allowed");
  signInConsumeSpy.mockReset().mockResolvedValue("allowed");
  signOutSpy.mockReset().mockResolvedValue({
    headers: new Headers({
      "set-cookie": "__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure",
    }),
  });
});

describe("hooks.server guard chain (request-layer redirects)", () => {
  it("returns 429 when the general authentication quota is exhausted", async () => {
    authConsumeSpy.mockResolvedValue("limited");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    const res = await callRoute({
      path: "/api/auth/callback/github",
      module: { GET: handler },
    });
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  }, 30_000);

  it("strictly limits mutating Better Auth GET routes", async () => {
    authConsumeSpy.mockResolvedValue("unavailable");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 302 }));
    const res = await callRoute({
      path: "/api/auth/callback/github",
      module: { GET: handler },
    });
    expect(res.status).toBe(503);
    expect(authConsumeSpy).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("strictly fails get-session closed when authentication limiting is unavailable", async () => {
    authConsumeSpy.mockResolvedValue("unavailable");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await callRoute({
      path: "/api/auth/get-session",
      module: { GET: handler },
    });
    expect(res.status).toBe(503);
    expect(authConsumeSpy).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 429 for exhausted password sign-in quota", async () => {
    signInConsumeSpy.mockResolvedValue("limited");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await callRoute({
      path: "/api/auth/sign-in/email",
      method: "POST",
      module: { POST: handler },
    });
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("applies the password sign-in quota to the username route", async () => {
    signInConsumeSpy.mockResolvedValue("limited");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await callRoute({
      path: "/api/auth/sign-in/username",
      method: "POST",
      module: { POST: handler },
    });
    expect(res.status).toBe(429);
    expect(signInConsumeSpy).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 503 when password sign-in limiting is unavailable", async () => {
    signInConsumeSpy.mockResolvedValue("unavailable");
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await callRoute({
      path: "/api/auth/sign-in/email",
      method: "POST",
      module: { POST: handler },
    });
    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not disguise an unknown password sign-in limiter error", async () => {
    const limiterError = new Error("limiter bug");
    signInConsumeSpy.mockRejectedValue(limiterError);
    await expect(
      callRoute({
        path: "/api/auth/sign-in/email",
        method: "POST",
        module: { POST: vi.fn() },
      }),
    ).rejects.toBe(limiterError);
  });

  it("does not disguise an unknown auth-limiter error", async () => {
    const limiterError = new Error("limiter bug");
    authConsumeSpy.mockRejectedValue(limiterError);
    await expect(
      callRoute({
        path: "/api/auth/callback/github",
        module: { GET: vi.fn() },
      }),
    ).rejects.toBe(limiterError);
  });

  it("does not resolve admin access for a non-admin account", async () => {
    const user = await createTestUser({
      username: "teacher_fast_path",
      platformRole: "teacher",
    });

    const res = await callRoute({ path: "/dashboard", module: NO_RESOLVE, user });

    expect(res.status).toBe(405);
    expect(resolveAdminAccessSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("redirects a must-change-password user to the change-password page", async () => {
    const user = await createTestUser({ username: "pw_user", mustChangePassword: true });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account/change-password");
  }, 30_000);

  it("redirects an unfinished super admin to the dedicated sign-in flow", async () => {
    const user = await createTestUser({
      username: "admin_user",
      platformRole: "admin",
      isSuperAdmin: true,
    });
    const res = await callRoute({
      path: "/dashboard",
      module: { GET: inspectAdminMode },
      user,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/admin-signin?returnTo=" + encodeURIComponent("/dashboard"),
    );
  }, 30_000);

  it("redirects an unverified super admin instead of granting ordinary access", async () => {
    const { getRedis, keys } = await import("@nojv/redis");
    await getRedis().del(keys.adminSessionMfa("test-session"));
    const user = await createTestUser({
      username: "admin_2fa_unverified",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
    });
    const res = await callRoute({
      path: "/dashboard",
      module: { GET: inspectAdminMode },
      user,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/admin-signin?returnTo=");
  }, 30_000);

  it("returns 403 for an unverified super admin API request", async () => {
    const user = await createTestUser({
      username: "admin_api_unverified",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
    });
    const res = await callRoute({
      path: "/api/admin/users",
      module: { GET: inspectAdminMode },
      user,
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "super_admin_mfa_required" });
  }, 30_000);

  it("gives a verified super admin direct admin access", async () => {
    const { adminMfaKind, markVerifiedSession, securityGenerationProof } =
      await import("@nojv/application");
    const { getRedis, keys } = await import("@nojv/redis");
    const user = await createTestUser({
      username: "admin_2fa_verified",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
    });
    await expect(
      markVerifiedSession("test-session", securityGenerationProof(user), adminMfaKind(user)),
    ).resolves.toBe(true);
    const res = await callRoute({
      path: "/dashboard",
      module: { GET: inspectAdminMode },
      user,
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ active: true });
    await getRedis().del(keys.adminSessionMfa("test-session"));
  }, 30_000);

  it("expires a stale super admin session in development", async () => {
    const user = await createTestUser({
      username: "admin_expired_session",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
    });

    const res = await callRoute({
      path: "/admin",
      module: NO_RESOLVE,
      user,
      headers: { "x-test-session-created-at": "2020-01-01T00:00:00.000Z" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin-signin?error=session-expired");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(signOutSpy).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      returnHeaders: true,
    });
  }, 30_000);

  it("binds a verified-factor handoff and grants the new superadmin session access", async () => {
    const {
      createStepUpHandoffTicket,
      hasAdminSessionMfa,
      hasFreshStepUp,
      clearStepUp,
      securityGenerationProof,
    } = await import("@nojv/application");
    const { getRedis, keys } = await import("@nojv/redis");
    const { STEP_UP_HANDOFF_COOKIE } = await import("$lib/server/step-up-handoff");
    const user = await createTestUser({
      username: "admin_handoff",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
    });
    const proof = securityGenerationProof(user);
    const ticket = await createStepUpHandoffTicket(proof);

    const res = await callRoute({
      path: "/dashboard",
      module: { GET: inspectAdminMode },
      user,
      cookies: { [STEP_UP_HANDOFF_COOKIE]: ticket },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ active: true });
    await expect(hasAdminSessionMfa("test-session", proof)).resolves.toBe(true);
    await expect(hasFreshStepUp("test-session", proof)).resolves.toBe(true);
    await getRedis().del(
      keys.adminSessionMfa("test-session"),
      keys.tokenPageMfa("test-session"),
    );
    await clearStepUp("test-session");
  }, 30_000);

  it("clears the session and redirects a disabled account to sign-in", async () => {
    const user = await createTestUser({ username: "disabled_user", disabled: true });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signin");
  }, 30_000);
});
