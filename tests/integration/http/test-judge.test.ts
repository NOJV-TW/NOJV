import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureDomainOrchestration } from "@nojv/application";
import {
  TEST_JUDGE_REQUEST_BODY_BYTES,
  type TestJudgeProgramBuildInput,
  type TestJudgeWorkflowInput,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import { storagePointerFor } from "@nojv/storage";

import * as testJudgeRoute from "../../../apps/web/src/routes/api/problems/[id]/test-judge/+server";
import { createTestProblem, createTestUser } from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.mock("$lib/server/domain-orchestration", () => ({}));

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

const runTestJudge =
  vi.fn<
    (
      input: TestJudgeWorkflowInput,
      options: { timeoutMs: number },
    ) => Promise<TestJudgeWorkflowOutput>
  >();
const dispatchTestJudgeProgramBuild =
  vi.fn<(input: TestJudgeProgramBuildInput) => Promise<void>>();

const checkerRequest = {
  kind: "checker",
  context: { type: "practice" },
  cases: [{ sampleIndex: 0, output: "3\n" }],
};

function checkerProblem() {
  return createTestProblem({
    judgeConfig: { type: "checker", checkerLanguage: "cpp" },
    checkerStorage: storagePointerFor(
      "problems/checker-fixture/checker.cpp",
      Buffer.from("int main() {}\n"),
    ),
    samples: [{ input: "1 2\n", output: "3\n" }],
  });
}

function postTestJudge(
  problemId: string,
  options: {
    user?: { id: string } | null;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  return callRoute({
    path: `/api/problems/${problemId}/test-judge`,
    method: "POST",
    module: testJudgeRoute,
    params: { id: problemId },
    user: options.user ?? null,
    body: options.body ?? checkerRequest,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}

beforeEach(() => {
  vi.stubEnv("TEST_JUDGE_ENABLED", "true");
  runTestJudge.mockReset().mockResolvedValue({ ok: true, cases: [{ verdict: "AC" }] });
  dispatchTestJudgeProgramBuild.mockReset().mockResolvedValue(undefined);
  configureDomainOrchestration({ runTestJudge, dispatchTestJudgeProgramBuild } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/problems/[id]/test-judge", () => {
  it("judges a practice checker sample and returns the verdicts", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();
    runTestJudge.mockResolvedValue({
      ok: true,
      cases: [{ verdict: "AC", teamMessage: "ok", timeMs: 3 }],
    });

    const response = await postTestJudge(problem.id, { user: student });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cases: [{ verdict: "AC", teamMessage: "ok", timeMs: 3 }],
    });
    expect(runTestJudge).toHaveBeenCalledOnce();
  });

  it("requires a signed-in user", async () => {
    const problem = await checkerProblem();

    const response = await postTestJudge(problem.id);

    expect(response.status).toBe(401);
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("refuses API-token callers", async () => {
    const problem = await checkerProblem();

    const response = await postTestJudge(problem.id, {
      headers: { authorization: "Bearer nojv_live_abcdefgh.abcdefghijklmnopqrstuvwxyz012345" },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "api_token_route_not_allowed",
    });
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("rejects a case that carries its own input", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();

    const response = await postTestJudge(problem.id, {
      user: student,
      body: { ...checkerRequest, cases: [{ sampleIndex: 0, output: "3\n", input: "1 2\n" }] },
    });

    expect(response.status).toBe(400);
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("rejects a declared body over the limit before reading it", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();

    const response = await postTestJudge(problem.id, {
      user: student,
      headers: { "content-length": String(TEST_JUDGE_REQUEST_BODY_BYTES + 1) },
    });

    expect(response.status).toBe(413);
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("maps other domain rejections to test_rejected", async () => {
    const student = await createTestUser();

    const response = await postTestJudge("missing-problem", { user: student });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "test_rejected" });
  });

  it("maps a judge program build failure to its code", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();
    runTestJudge.mockResolvedValue({ ok: false, code: "judge_program_build_failed" });

    const response = await postTestJudge(problem.id, { user: student });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "judge_program_build_failed",
      message: "judge_program_build_failed",
    });
  });

  it("reports a busy test judge as 503 test_judge_busy", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();
    runTestJudge.mockResolvedValue({ ok: false, code: "test_judge_busy" });

    const response = await postTestJudge(problem.id, { user: student });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "test_judge_busy",
      message: "test_judge_busy",
    });
  });

  it("allows one request per user in flight and frees the slot afterwards", async () => {
    const student = await createTestUser();
    const other = await createTestUser();
    const problem = await checkerProblem();
    let finish: (output: TestJudgeWorkflowOutput) => void = () => undefined;
    runTestJudge.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const first = postTestJudge(problem.id, { user: student });
    await vi.waitFor(() => expect(runTestJudge).toHaveBeenCalledOnce());

    const concurrent = await postTestJudge(problem.id, { user: student });
    expect(concurrent.status).toBe(429);
    await expect(concurrent.json()).resolves.toEqual({
      code: "test_judge_busy",
      message: "test_judge_busy",
    });
    expect((await postTestJudge(problem.id, { user: other })).status).toBe(200);

    finish({ ok: true, cases: [{ verdict: "WA" }] });
    expect((await first).status).toBe(200);
    expect((await postTestJudge(problem.id, { user: student })).status).toBe(200);
    expect(runTestJudge).toHaveBeenCalledTimes(3);
  });

  it("frees the slot after a rejected request", async () => {
    const student = await createTestUser();
    const problem = await checkerProblem();

    const rejected = await postTestJudge(problem.id, {
      user: student,
      body: { ...checkerRequest, cases: [] },
    });
    expect(rejected.status).toBe(400);

    expect((await postTestJudge(problem.id, { user: student })).status).toBe(200);
  });
});
