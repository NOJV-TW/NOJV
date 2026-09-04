import type { RequestHandler } from "@sveltejs/kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStepUpHandoffTicket,
  adminMfaKind,
  hasAdminSessionMfa,
  markVerifiedSession,
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
          ? { session: { createdAt: new Date(), id: "test-session", userId }, user }
          : null;
      },
    },
  }),
}));

const sessionId = "test-session";
const adminModeRoute = await import("$lib/../routes/api/admin-mode/+server");
const inspectAccess: RequestHandler = (event) =>
  new Response(JSON.stringify({ active: event.locals.adminAccessActive }));

async function clearProofs(): Promise<void> {
  await getRedis().del(
    keys.apiTokenStepUp(sessionId),
    keys.tokenPageMfa(sessionId),
    keys.adminSessionMfa(sessionId),
    keys.adminMode(sessionId),
    keys.securitySettingsGrant(sessionId),
  );
}

async function postMode(user: { id: string }, active: boolean): Promise<Response> {
  return callRoute({
    body: { active },
    method: "POST",
    module: adminModeRoute,
    path: "/api/admin-mode",
    user,
  });
}

async function currentProof(userId: string) {
  return securityGenerationProof(
    await testPrisma.user.findUniqueOrThrow({ where: { id: userId } }),
  );
}

async function verifySession(userId: string): Promise<void> {
  const user = await testPrisma.user.findUniqueOrThrow({ where: { id: userId } });
  await expect(
    markVerifiedSession(sessionId, securityGenerationProof(user), adminMfaKind(user)),
  ).resolves.toBe(true);
}

afterEach(clearProofs);

describe("admin access", () => {
  it("requires a same-session verification proof for a regular admin", async () => {
    const user = await createTestUser({ platformRole: "admin" });
    const response = await postMode(user, true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      active: false,
      verificationRequired: true,
    });
  });

  it("enters regular admin mode after one shared verification", async () => {
    const user = await createTestUser({ platformRole: "admin", twoFactorEnabled: true });
    await verifySession(user.id);
    await expect((await postMode(user, true)).json()).resolves.toEqual({ active: true });
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBe(
      securityGenerationMarker(await currentProof(user.id)),
    );
    expect(await getRedis().ttl(keys.adminSessionMfa(sessionId))).toBeGreaterThan(0);
    expect(await getRedis().ttl(keys.adminSessionMfa(sessionId))).toBeLessThanOrEqual(600);
    expect(await getRedis().ttl(keys.adminMode(sessionId))).toBeGreaterThan(600);
  });

  it("preserves the 10-minute proof when leaving and re-entering regular admin mode", async () => {
    const user = await createTestUser({ platformRole: "admin", twoFactorEnabled: true });
    await verifySession(user.id);
    expect((await postMode(user, true)).status).toBe(200);
    await expect((await postMode(user, false)).json()).resolves.toEqual({ active: false });
    await expect(getRedis().get(keys.adminSessionMfa(sessionId))).resolves.not.toBeNull();
    await expect(getRedis().get(keys.apiTokenStepUp(sessionId))).resolves.not.toBeNull();
    await expect((await postMode(user, true)).json()).resolves.toEqual({ active: true });
  });

  it("keeps an entered regular admin mode after the 10-minute re-entry proof expires", async () => {
    const user = await createTestUser({ platformRole: "admin", twoFactorEnabled: true });
    await verifySession(user.id);
    expect((await postMode(user, true)).status).toBe(200);
    await getRedis().del(keys.adminSessionMfa(sessionId), keys.apiTokenStepUp(sessionId));
    const response = await callRoute({ module: { GET: inspectAccess }, path: "/admin", user });
    await expect(response.json()).resolves.toEqual({ active: true });
  });

  it("rejects the admin-mode endpoint for super admins", async () => {
    const user = await createTestUser({ isSuperAdmin: true, platformRole: "admin" });
    await verifySession(user.id);
    expect((await postMode(user, true)).status).toBe(403);
    expect((await postMode(user, false)).status).toBe(403);
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("gives a verified super admin direct access without a mode marker", async () => {
    const user = await createTestUser({ isSuperAdmin: true, platformRole: "admin" });
    await verifySession(user.id);
    const response = await callRoute({
      module: { GET: inspectAccess },
      path: "/admin",
      user,
    });
    await expect(response.json()).resolves.toEqual({ active: true });
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
    expect(await getRedis().ttl(keys.adminSessionMfa(sessionId))).toBeGreaterThan(600);
    expect(await getRedis().ttl(keys.adminSessionMfa(sessionId))).toBeLessThanOrEqual(86_400);
  });

  it("rejects an admin mode marker from an older security generation", async () => {
    const user = await createTestUser({ platformRole: "admin" });
    await getRedis().set(keys.adminMode(sessionId), `sg1:${user.id}:999`, "EX", 600);
    const response = await callRoute({
      module: { GET: inspectAccess },
      path: "/dashboard",
      user,
    });
    await expect(response.json()).resolves.toEqual({ active: false });
    await expect(getRedis().get(keys.adminMode(sessionId))).resolves.toBeNull();
  });

  it("fails closed for non-admin and disabled accounts", async () => {
    for (const user of [
      await createTestUser({ platformRole: "teacher" }),
      await createTestUser({ disabled: true, platformRole: "admin" }),
    ]) {
      const marker = securityGenerationMarker(await currentProof(user.id));
      await getRedis().set(keys.adminSessionMfa(sessionId), marker, "EX", 600);
      await getRedis().set(keys.adminMode(sessionId), marker, "EX", 600);
      const response = await callRoute({
        module: { GET: inspectAccess },
        path: "/dashboard",
        user,
      });
      if (!user.disabled) await expect(response.json()).resolves.toEqual({ active: false });
      else expect(response.status).toBe(302);
      await clearProofs();
    }
  });

  it("invalidates existing proofs when a factor changes the durable generation", async () => {
    const user = await createTestUser({ platformRole: "admin" });
    await verifySession(user.id);
    expect((await postMode(user, true)).status).toBe(200);
    await testPrisma.passkey.create({
      data: {
        backedUp: false,
        counter: 0,
        credentialID: `credential-${user.id}`,
        deviceType: "singleDevice",
        id: `passkey-${user.id}`,
        publicKey: "public-key",
        userId: user.id,
      },
    });
    const response = await callRoute({
      module: { GET: inspectAccess },
      path: "/dashboard",
      user,
    });
    await expect(response.json()).resolves.toEqual({ active: false });
  });

  it("rejects a verification handoff created before a role-generation change", async () => {
    const { userDomain } = await import("@nojv/application");
    const { STEP_UP_HANDOFF_COOKIE } = await import("$lib/server/step-up-handoff");
    const user = await createTestUser({ platformRole: "admin" });
    const ticket = await createStepUpHandoffTicket(await currentProof(user.id));
    await userDomain.updateUserRole(true, user.id, "teacher");
    await userDomain.updateUserRole(true, user.id, "admin");
    await callRoute({
      cookies: { [STEP_UP_HANDOFF_COOKIE]: ticket },
      module: {},
      path: "/dashboard",
      user,
    });
    await expect(hasAdminSessionMfa(sessionId, await currentProof(user.id))).resolves.toBe(
      false,
    );
  });
});
