import { describe, expect, it } from "vitest";

import { callRoute } from "./_harness";

const authRoute = await import("../../../apps/web/src/routes/api/auth/[...path]/+server");

describe("POST /api/auth/sign-up/email (public sign-up is disabled)", () => {
  it("rejects email sign-up with a 4xx", async () => {
    const res = await callRoute({
      path: "/api/auth/sign-up/email",
      method: "POST",
      module: authRoute,
      body: { email: "newcomer@test.local", password: "password123", name: "Newcomer" },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }, 30_000);
});
