import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createStorageClient, putImmutableText } from "@nojv/storage";

import { createTestProblem, createTestUser } from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma } = await import("../../fixtures/factories");
        const user = await testPrisma.user.findUnique({ where: { id: userId } });
        return user
          ? { session: { id: "judge-program-session", createdAt: new Date(), userId }, user }
          : null;
      },
    },
  }),
}));

const judgeProgramRoute =
  await import("../../../apps/web/src/routes/api/problems/[id]/judge-program/+server");

const checkerSource = "accept()\n";

async function checkerProblem(visibility: "public" | "private" = "public") {
  const checkerStorage = await putImmutableText(
    createStorageClient(),
    `problems/checker-${Math.random()}/checker.py`,
    checkerSource,
  );
  return createTestProblem({
    visibility,
    judgeConfig: { type: "checker", checkerLanguage: "python" },
    checkerStorage,
  });
}

function getJudgeProgram(
  problemId: string,
  user: { id: string } | null,
  context: string | null = JSON.stringify({ type: "practice" }),
): Promise<Response> {
  const query = context === null ? "" : `?context=${encodeURIComponent(context)}`;
  return callRoute({
    path: `/api/problems/${problemId}/judge-program${query}`,
    module: judgeProgramRoute,
    params: { id: problemId },
    user,
  });
}

describe("GET /api/problems/[id]/judge-program", () => {
  it("returns a viewable problem's checker source", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();

    const response = await getJudgeProgram(problem.id, student);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      role: "checker",
      language: "python",
      source: checkerSource,
      sha256: createHash("sha256").update(checkerSource).digest("hex"),
    });
  });

  it("requires a signed-in user", async () => {
    const problem = await checkerProblem();

    expect((await getJudgeProgram(problem.id, null)).status).toBe(401);
  });

  it.each([
    ["missing", null],
    ["not JSON", "practice"],
    ["not a context", JSON.stringify({ type: "homework" })],
  ])("rejects a context that is %s", async (_label, context) => {
    const student = await createTestUser();
    const problem = await checkerProblem();

    expect((await getJudgeProgram(problem.id, student, context)).status).toBe(400);
  });

  it("answers 404 for a private problem the user cannot view", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem("private");

    expect((await getJudgeProgram(problem.id, student)).status).toBe(404);
  });

  it("answers 404 for a standard problem", async () => {
    const student = await createTestUser();
    const problem = await createTestProblem({ judgeConfig: { type: "standard" } });

    expect((await getJudgeProgram(problem.id, student)).status).toBe(404);
  });
});
