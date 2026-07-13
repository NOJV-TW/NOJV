import type { RequestHandler } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStepUpHandoffTicket,
  hasAdminSessionMfa,
  markVerifiedSession as persistVerifiedSession,
  securityGenerationMarker,
  securityGenerationProof,
} from "@nojv/application";
import { getRedis, keys } from "@nojv/redis";

import { createTestUser, testPrisma } from "../../fixtures/factories";
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

async function currentProof(userId: string) {
  const user = await testPrisma.user.findUniqueOrThrow({ where: { id: userId } });
  return securityGenerationProof(user);
}

async function currentElevationMarker(userId: string): Promise<string> {
  return securityGenerationMarker(await currentProof(userId));
}

async function markVerifiedSession(userId: string): Promise<void> {
  await expect(
    persistVerifiedSession(sessionId, await currentProof(userId), true),
  ).resolves.toBe(true);
}

afterEach(clearElevation);

describe("admin mode MFA invariant", () => {
  it("rejects activation when the current admin account has not activated 2FA", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: false,
    });
    await persistVerifiedSession(sessionId, await currentProof(user.id), true);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("rejects activation without a fresh same-session step-up", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    const marker = await currentElevationMarker(user.id);
    await getRedis().set(keys.adminSessionMfa(sessionId), marker, "EX", 600);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("rejects activation without an MFA marker for the same session and account", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    const marker = await currentElevationMarker(user.id);
    await getRedis().set(keys.apiTokenStepUp(sessionId), marker, "EX", 600);
    await getRedis().set(keys.adminSessionMfa(sessionId), "sg1:another-user:0", "EX", 600);

    const response = await activate(user);

    expect(response.status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("fails closed and clears stale admin mode state during request resolution", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await getRedis().set(
      keys.adminMode(sessionId),
      await currentElevationMarker(user.id),
      "EX",
      600,
    );
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
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBe(
      await currentElevationMarker(user.id),
    );
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
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBe(
      await currentElevationMarker(user.id),
    );
  });

  it("always permits de-elevation and atomically removes both elevation keys", async () => {
    const user = await createTestUser({ platformRole: "teacher" });
    const marker = await currentElevationMarker(user.id);
    await getRedis().set(keys.adminSessionMfa(sessionId), marker, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), marker, "EX", 600);

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
    const marker = await currentElevationMarker(user.id);
    await getRedis().set(keys.adminSessionMfa(sessionId), marker, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), marker, "EX", 600);
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
    const marker = await currentElevationMarker(user.id);
    await getRedis().set(keys.adminSessionMfa(sessionId), marker, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), marker, "EX", 600);

    const response = await callRoute({ path: "/dashboard", module: {}, user });

    expect(response.status).toBe(302);
    const [mfa, mode] = await getRedis().mget(
      keys.adminSessionMfa(sessionId),
      keys.adminMode(sessionId),
    );
    expect([mfa, mode]).toEqual([null, null]);
  });

  it("does not revive elevation recreated during demotion after re-promotion", async () => {
    const { userDomain } = await import("@nojv/application");
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    const staleMarker = await currentElevationMarker(user.id);
    await getRedis().set(keys.adminSessionMfa(sessionId), staleMarker, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), staleMarker, "EX", 600);

    await userDomain.updateUserRole(true, user.id, "teacher");
    // Models a grant that passed its role check before demotion and wrote after
    // the demotion's session snapshot had already been cleaned.
    await getRedis().set(keys.adminSessionMfa(sessionId), staleMarker, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), staleMarker, "EX", 600);
    await userDomain.updateUserRole(true, user.id, "admin");

    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));
    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
    const [mfa, mode] = await getRedis().mget(
      keys.adminSessionMfa(sessionId),
      keys.adminMode(sessionId),
    );
    expect([mfa, mode]).toEqual([null, null]);
  });

  it("rejects a handoff verified before demotion after the account is re-promoted", async () => {
    const { userDomain } = await import("@nojv/application");
    const { STEP_UP_HANDOFF_COOKIE } = await import("$lib/server/step-up-handoff");
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    const ticket = await createStepUpHandoffTicket(await currentProof(user.id));

    await userDomain.updateUserRole(true, user.id, "teacher");
    await userDomain.updateUserRole(true, user.id, "admin");
    await callRoute({
      path: "/dashboard",
      module: {},
      user,
      cookies: { [STEP_UP_HANDOFF_COOKIE]: ticket },
    });

    await expect(hasAdminSessionMfa(sessionId, await currentProof(user.id))).resolves.toBe(
      false,
    );
  });

  it("does not make an old marker valid when its Redis generation is missing", async () => {
    const { userDomain } = await import("@nojv/application");
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);
    expect((await activate(user)).status).toBe(200);
    const staleMarker = await getRedis().get(keys.adminMode(sessionId));
    expect(staleMarker).not.toBeNull();

    await userDomain.updateUserRole(true, user.id, "teacher");
    await userDomain.updateUserRole(true, user.id, "admin");
    await getRedis().set(keys.adminSessionMfa(sessionId), staleMarker!, "EX", 600);
    await getRedis().set(keys.adminMode(sessionId), staleMarker!, "EX", 600);
    // The legacy Redis epoch is deliberately irrelevant: deleting it must not
    // make a marker from an older durable database generation valid again.
    await getRedis().del(`nojv:admin:epoch:${user.id}`);
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));

    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("invalidates elevation across disable and re-enable", async () => {
    const { userDomain } = await import("@nojv/application");
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);
    expect((await activate(user)).status).toBe(200);

    await userDomain.setUserDisabled(true, user.id, true);
    await userDomain.setUserDisabled(true, user.id, false);
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));
    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("invalidates elevation across 2FA deactivation and reactivation", async () => {
    const { setTwoFactorActivated } = await import("@nojv/application");
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);
    expect((await activate(user)).status).toBe(200);

    await setTwoFactorActivated(user.id, false);
    await setTwoFactorActivated(user.id, true);
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));
    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("invalidates elevation when a TOTP factor is added directly", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);
    expect((await activate(user)).status).toBe(200);

    await testPrisma.twoFactor.create({
      data: {
        id: `totp-${user.id}`,
        userId: user.id,
        secret: "encrypted-secret",
        backupCodes: "encrypted-backup-codes",
      },
    });
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));
    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("invalidates elevation when a passkey is added directly", async () => {
    const user = await createTestUser({
      platformRole: "admin",
      twoFactorActivated: true,
    });
    await markVerifiedSession(user.id);
    expect((await activate(user)).status).toBe(200);

    await testPrisma.passkey.create({
      data: {
        id: `passkey-${user.id}`,
        userId: user.id,
        publicKey: "public-key",
        credentialID: `credential-${user.id}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      },
    });
    const inspectLocals: RequestHandler = (event) =>
      new Response(JSON.stringify({ active: event.locals.adminModeActive }));
    const response = await callRoute({
      path: "/dashboard",
      module: { GET: inspectLocals },
      user,
    });

    await expect(response.json()).resolves.toEqual({ active: false });
  });
});
