import type { RequestHandler } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRedis, keys } from "@nojv/redis";

import { createTestUser } from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma } = await import("../../fixtures/factories");
        const user = await testPrisma.user.findUnique({ where: { id: userId } });
        return user
          ? { session: { id: "test-session", userId, createdAt: new Date() }, user }
          : null;
      },
    },
  }),
}));

const sessionId = "test-session";
const adminModeRoute = await import("$lib/../routes/api/admin-mode/+server");

async function clearElevation(): Promise<void> {
  await getRedis().del(
    keys.apiTokenStepUp(sessionId),
    keys.adminSessionMfa(sessionId),
    keys.adminMode(sessionId),
  );
}

async function activate(user: { id: string }): Promise<Response> {
  return callRoute({
    path: "/api/admin-mode",
    method: "POST",
    module: adminModeRoute,
    user,
    body: { active: true },
  });
}

async function deactivate(user: { id: string }): Promise<Response> {
  return callRoute({
    path: "/api/admin-mode",
    method: "POST",
    module: adminModeRoute,
    user,
    body: { active: false },
  });
}

async function markVerifiedSession(userId: string): Promise<void> {
  await getRedis().set(keys.apiTokenStepUp(sessionId), "1", "EX", 600);
  await getRedis().set(keys.adminSessionMfa(sessionId), userId, "EX", 600);
}

afterEach(clearElevation);

describe("admin mode MFA invariant", () => {
  it("rejects activation when the current admin account has not activated 2FA", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: false,
    });
    await getRedis().set(keys.apiTokenStepUp(sessionId), "1", "EX", 600);
    await getRedis().set(keys.adminSessionMfa(sessionId), user.id, "EX", 600);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("rejects activation without a fresh same-session step-up", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await getRedis().set(keys.adminSessionMfa(sessionId), user.id, "EX", 600);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("rejects activation without an MFA marker for the same session and account", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await getRedis().set(keys.apiTokenStepUp(sessionId), "1", "EX", 600);
    await getRedis().set(keys.adminSessionMfa(sessionId), "another-user", "EX", 600);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("fails closed and clears stale admin mode state during request resolution", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await getRedis().set(keys.adminMode(sessionId), user.id, "EX", 600);
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));

    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("grants a regular admin only when both MFA markers belong to the current session", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);

    const response = await activate(user);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: true });
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBe(user.id);
  });

  it("applies the same elevation invariant to super admins", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);

    const response = await activate(user);

    expect(response.status).toBe(200);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBe(user.id);
  });

  it("always permits de-elevation and atomically removes both elevation keys", async () => {
    const user = await createTestUser({ platformRole: "teacher" });
    await getRedis().set(keys.adminSessionMfa(sessionId), user.id, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), user.id, "EX", 600);

    const response = await deactivate(user);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
    const [mfa, mode] = await getRedis().mget(
      keys.adminSessionMfa(sessionId),
      keys.adminMode(sessionId),
    );
    expect([mfa, mode]).toEqual([null, null]);
  });

  it("fails closed when a non-admin account has stale elevation keys", async () => {
    const user = await createTestUser({ platformRole: "teacher", twoFactorActivated: true });
    await getRedis().set(keys.adminSessionMfa(sessionId), user.id, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), user.id, "EX", 600);
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));

    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("clears elevation before redirecting a disabled admin", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      disabled: true,
      twoFactorActivated: true,
    });
    await getRedis().set(keys.adminSessionMfa(sessionId), user.id, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), user.id, "EX", 600);

    const response = await callRoute({ path: "/dashboard", module: {}, user });

    expect(response.status).toBe(302);
    const [mfa, mode] = await getRedis().mget(
      keys.adminSessionMfa(sessionId),
      keys.adminMode(sessionId),
    );
    expect([mfa, mode]).toEqual([null, null]);
  });
});
