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
        return user ? { session: { id: "test-session", userId }, user } : null;
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

  it("redirects an admin without 2FA to the two-factor setup on /admin", async () => {
    const user = await createTestUser({ username: "admin_user", platformRole: "admin" });
    const res = await callRoute({ path: "/admin", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account/two-factor");
  }, 30_000);

  it("clears the session and redirects a disabled account to sign-in", async () => {
    const user = await createTestUser({ username: "disabled_user", disabled: true });
    const res = await callRoute({ path: "/settings", module: NO_RESOLVE, user });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/signin");
  }, 30_000);
});
