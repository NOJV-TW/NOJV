import { describe, expect, it, vi } from "vitest";

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

const NO_RESOLVE = {};

describe("hooks.server guard chain (request-layer redirects)", () => {
  it("redirects a must-change-password user to the change-password page", async () => {
    const user = await createTestUser({ username: "pw_user", mustChangePassword: true });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account/change-password");
  }, 30_000);

  it("redirects a super admin without the 2FA master switch on to setup on /admin", async () => {
    const user = await createTestUser({
      username: "admin_user",
      platformRole: "admin",
      isSuperAdmin: true,
    });
    const res = await callRoute({ path: "/admin", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account?setup2fa=1");
  }, 30_000);

  it("redirects a super admin with 2FA on but an unverified session to step-up verify", async () => {
    const { getRedis, keys } = await import("@nojv/redis");
    await getRedis().del(keys.adminSessionMfa("test-session"));
    const user = await createTestUser({
      username: "admin_2fa_unverified",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
      twoFactorActivated: true,
    });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/account/api-tokens/verify?returnTo=${encodeURIComponent("/settings")}`,
    );
  }, 30_000);

  it("allows a super admin whose session already passed 2FA", async () => {
    const { getRedis, keys } = await import("@nojv/redis");
    await getRedis().set(keys.adminSessionMfa("test-session"), "1", "EX", 600);
    const user = await createTestUser({
      username: "admin_2fa_verified",
      platformRole: "admin",
      isSuperAdmin: true,
      twoFactorEnabled: true,
      twoFactorActivated: true,
    });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).not.toBe(302);
    await getRedis().del(keys.adminSessionMfa("test-session"));
  }, 30_000);

  it("clears the session and redirects a disabled account to sign-in", async () => {
    const user = await createTestUser({ username: "disabled_user", disabled: true });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signin");
  }, 30_000);
});
