import { describe, expect, it, vi } from "vitest";

import * as submissionHistoryRoute from "../../../apps/web/src/routes/api/submissions/+server";
import {
  createTestContest,
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";
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

describe("GET /api/submissions?context=contest", () => {
  it("serves the contest's submission history to its organizer and refuses everyone else", async () => {
    const organizer = await createTestUser();
    const student = await createTestUser();
    const contest = await createTestContest({ createdByUserId: organizer.id });
    const problem = await createTestProblem({ authorId: organizer.id });
    const row = await createTestSubmission({
      userId: student.id,
      problemId: problem.id,
      contestId: contest.id,
    });
    await createTestSubmission({ userId: student.id, problemId: problem.id });

    const read = (user: typeof organizer) =>
      callRoute({
        path: `/api/submissions?${new URLSearchParams({ context: "contest", id: contest.id })}`,
        module: submissionHistoryRoute,
        user,
      });

    const allowed = await read(organizer);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      items: [{ id: row.id }],
      totalCount: 1,
    });

    const denied = await read(student);
    expect(denied.status).toBe(403);
  });

  it("orders the contest's history by score on request and rejects unknown sort keys", async () => {
    const organizer = await createTestUser();
    const student = await createTestUser();
    const contest = await createTestContest({ createdByUserId: organizer.id });
    const problem = await createTestProblem({ authorId: organizer.id });
    const seeded = [];
    for (const [minute, score] of [
      [1, 50],
      [2, 10],
      [3, 90],
    ] as const) {
      seeded.push(
        await createTestSubmission({
          userId: student.id,
          problemId: problem.id,
          contestId: contest.id,
          score,
          createdAt: new Date(Date.UTC(2026, 9, 1, 0, minute)),
        }),
      );
    }
    const read = (params: Record<string, string>) =>
      callRoute({
        path: `/api/submissions?${new URLSearchParams({ context: "contest", id: contest.id, ...params })}`,
        module: submissionHistoryRoute,
        user: organizer,
      });

    const ascending = await read({ sort: "score", order: "asc" });
    expect(ascending.status).toBe(200);
    const body = (await ascending.json()) as { items: { id: string; score: number }[] };
    expect(body.items.map((item) => item.score)).toEqual([10, 50, 90]);
    expect(body.items.map((item) => item.id)).toEqual([
      seeded[1]!.id,
      seeded[0]!.id,
      seeded[2]!.id,
    ]);

    const invalid = await read({ sort: "id" });
    expect(invalid.status).toBe(400);
  });
});
