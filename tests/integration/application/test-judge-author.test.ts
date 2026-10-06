import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ForbiddenError,
  ServiceUnavailableError,
  ValidationError,
  configureDomainOrchestration,
  testJudgeDomain,
} from "@nojv/application";
import {
  TEST_JUDGE_REQUEST_PREFIX,
  testJudgeProgramCacheKey,
  testJudgeProgramObjectKey,
  type JudgeProgramSource,
  type TestJudgeWorkflowInput,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import { createStorageClient, getText, listByPrefix, putImmutableText } from "@nojv/storage";

import { createTestProblem, createTestUser } from "../../fixtures/factories";

const runTestJudge =
  vi.fn<
    (
      input: TestJudgeWorkflowInput,
      options: { timeoutMs: number },
    ) => Promise<TestJudgeWorkflowOutput>
  >();

const CHECKER_SOURCE = "int main() { return 42; }\n";
const samples = [
  { input: "1 2\n", output: "3\n" },
  { input: "5 6\n", output: "11\n", explanation: "5 + 6" },
];

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

async function author() {
  return actorOf(await createTestUser({ platformRole: "teacher" }));
}

async function checkerProblem(authorId: string, source = CHECKER_SOURCE) {
  const checkerStorage = await putImmutableText(
    createStorageClient(),
    `problems/${authorId}/checker.cpp`,
    source,
  );
  return createTestProblem({
    authorId,
    visibility: "private",
    judgeConfig: { type: "checker", checkerLanguage: "cpp" },
    checkerStorage,
    samples,
    timeLimitMs: 2000,
    memoryLimitMb: 128,
  });
}

async function seedProgramRecord(source: JudgeProgramSource, body: string) {
  await putImmutableText(
    createStorageClient(),
    testJudgeProgramObjectKey(await testJudgeProgramCacheKey(source)),
    body,
  );
}

beforeEach(() => {
  vi.stubEnv("TEST_JUDGE_ENABLED", "true");
  runTestJudge.mockReset();
  configureDomainOrchestration({ runTestJudge } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("testJudgeDomain.getJudgeProgramStatus", () => {
  it("is not applicable to a standard problem", async () => {
    const owner = await author();
    const problem = await createTestProblem({ authorId: owner.userId });

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "not_applicable",
    });
  });

  it("is not applicable while the test judge is disabled", async () => {
    vi.stubEnv("TEST_JUDGE_ENABLED", "false");
    const owner = await author();
    const problem = await checkerProblem(owner.userId);

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "not_applicable",
    });
  });

  it("is pending until the build record exists", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "pending",
    });
  });

  it("treats an unreadable build record as pending", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);
    await seedProgramRecord(
      { role: "checker", language: "cpp", source: CHECKER_SOURCE },
      '{"status":"mystery"}',
    );

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "pending",
    });
  });

  it("reports a successful build", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);
    await seedProgramRecord(
      { role: "checker", language: "cpp", source: CHECKER_SOURCE },
      JSON.stringify({
        status: "ok",
        artifact: { kind: "wasm", bytes: { base64: "AGFzbQ==" } },
      }),
    );

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "ok",
    });
  });

  it("reports a failed build with its diagnostics", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);
    await seedProgramRecord(
      { role: "checker", language: "cpp", source: CHECKER_SOURCE },
      JSON.stringify({ status: "failed", diagnostics: "main.cpp:1:1: error: boom" }),
    );

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "failed",
      diagnostics: "main.cpp:1:1: error: boom",
    });
  });

  it("reads the record of the saved interactor", async () => {
    const owner = await author();
    const source = "int main() {}\n";
    const interactorStorage = await putImmutableText(
      createStorageClient(),
      `problems/${owner.userId}/interactor.cpp`,
      source,
    );
    const problem = await createTestProblem({
      authorId: owner.userId,
      judgeConfig: { type: "interactive", interactorLanguage: "cpp" },
      interactorStorage,
    });
    await seedProgramRecord(
      { role: "interactor", language: "cpp", source },
      JSON.stringify({ status: "failed", diagnostics: "no threads" }),
    );

    await expect(testJudgeDomain.getJudgeProgramStatus(owner, problem.id)).resolves.toEqual({
      status: "failed",
      diagnostics: "no threads",
    });
  });

  it("forbids someone who cannot edit the problem", async () => {
    const owner = await author();
    const other = await author();
    const problem = await checkerProblem(owner.userId);

    await expect(
      testJudgeDomain.getJudgeProgramStatus(other, problem.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("testJudgeDomain.checkSamplesWithChecker", () => {
  it("judges every sample output as its own answer and maps the verdicts", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);
    const seen: unknown[] = [];
    runTestJudge.mockImplementation(async ({ requestKey }) => {
      seen.push(JSON.parse(await getText(createStorageClient(), requestKey)));
      return {
        ok: true,
        cases: [
          { verdict: "AC", teamMessage: "", timeMs: 2 },
          { verdict: "WA", teamMessage: "expected YES or NO", timeMs: 3 },
        ],
      };
    });

    const results = await testJudgeDomain.checkSamplesWithChecker(owner, problem.id);

    expect(results).toEqual([
      { sampleIndex: 0, verdict: "AC" },
      { sampleIndex: 1, verdict: "WA", teamMessage: "expected YES or NO" },
    ]);
    expect(seen).toEqual([
      {
        kind: "checker",
        judgeLanguage: "cpp",
        judgeScriptPointer: problem.checkerStorage,
        timeLimitMs: 2000,
        memoryLimitMb: 128,
        runtimeEnv: {},
        cases: [
          { input: "1 2\n", expectedOutput: "3\n", output: "3\n" },
          { input: "5 6\n", expectedOutput: "11\n", output: "11\n" },
        ],
      },
    ]);
    expect(await listByPrefix(createStorageClient(), TEST_JUDGE_REQUEST_PREFIX)).toEqual([]);
  });

  it("maps a busy workflow like Test does", async () => {
    const owner = await author();
    const problem = await checkerProblem(owner.userId);
    runTestJudge.mockResolvedValue({ ok: false, code: "test_judge_busy" });

    const error = await testJudgeDomain
      .checkSamplesWithChecker(owner, problem.id)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect((error as Error).message).toBe("test_judge_busy");
  });

  it("forbids a student who cannot edit the problem", async () => {
    const owner = await author();
    const student = actorOf(await createTestUser({ platformRole: "student" }));
    const problem = await checkerProblem(owner.userId);

    await expect(
      testJudgeDomain.checkSamplesWithChecker(student, problem.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it.each([
    ["standard", {}],
    ["interactive", { judgeConfig: { type: "interactive", interactorLanguage: "cpp" } }],
  ] as const)("rejects a %s problem", async (_kind, overrides) => {
    const owner = await author();
    const problem = await createTestProblem({ authorId: owner.userId, ...overrides });

    await expect(
      testJudgeDomain.checkSamplesWithChecker(owner, problem.id),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTestJudge).not.toHaveBeenCalled();
  });
});
