import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as submissionsRoute from "../../../apps/web/src/routes/api/submissions/+server";
import { createTestProblem, createTestUser } from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma: prisma } = await import("../../fixtures/factories");
        const user = await prisma.user.findUnique({ where: { id: userId } });
        return user
          ? {
              session: { id: `session-${userId}`, userId, createdAt: new Date() },
              user,
            }
          : null;
      },
    },
  }),
}));

describe("POST /api/submissions cooldown", () => {
  const previousFloor = process.env.SUBMIT_COOLDOWN_MIN_SEC;

  beforeEach(() => {
    process.env.SUBMIT_COOLDOWN_MIN_SEC = "30";
  });

  afterEach(() => {
    if (previousFloor === undefined) delete process.env.SUBMIT_COOLDOWN_MIN_SEC;
    else process.env.SUBMIT_COOLDOWN_MIN_SEC = previousFloor;
  });

  it("returns the cooldown on success and a retry hint while it lasts", async () => {
    const student = await createTestUser();
    const problem = await createTestProblem();
    const submit = () =>
      callRoute({
        path: "/api/submissions",
        method: "POST",
        module: submissionsRoute,
        user: student,
        body: {
          context: { type: "practice" },
          problemId: problem.id,
          language: "python",
          sourceCode: "print(1)",
        },
      });

    const accepted = await submit();
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ cooldownSec: 30 });

    const rejected = await submit();
    expect(rejected.status).toBe(403);
    const body = (await rejected.json()) as { code: string; retryAfterSec: number };
    expect(body.code).toBe("submit_cooldown");
    expect(body.retryAfterSec).toBeGreaterThan(0);
    expect(body.retryAfterSec).toBeLessThanOrEqual(30);
  });
});
