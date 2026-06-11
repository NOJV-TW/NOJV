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

const notifications = await import("../../../apps/web/src/routes/api/notifications/+server");

describe("GET /api/notifications (hooks auth gate → handler)", () => {
  it("returns 401 when unauthenticated (requireApiAuth → api-handler status mapping)", async () => {
    const res = await callRoute({ path: "/api/notifications", module: notifications });
    expect(res.status).toBe(401);
  }, 30_000);

  it("returns 200 with items[] when authenticated", async () => {
    const user = await createTestUser({ username: "notif_user" });
    const res = await callRoute({ path: "/api/notifications", module: notifications, user });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; unreadCount: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.unreadCount).toBe("number");
  }, 30_000);
});
