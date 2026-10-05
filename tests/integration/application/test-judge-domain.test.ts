import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  ServiceUnavailableError,
  ValidationError,
  configureDomainOrchestration,
  problemDomain,
  testJudgeDomain,
} from "@nojv/application";
import {
  TEST_JUDGE_REQUEST_PREFIX,
  type TestJudgeProgramBuildInput,
  type TestJudgeRequest,
  type TestJudgeWorkflowInput,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import {
  assertStorageObjectPointer,
  createStorageClient,
  getText,
  listByPrefix,
  storagePointerFor,
} from "@nojv/storage";

import {
  createTestCourse,
  createTestExam,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";

const runTestJudge =
  vi.fn<
    (
      input: TestJudgeWorkflowInput,
      options: { timeoutMs: number },
    ) => Promise<TestJudgeWorkflowOutput>
  >();
const dispatchTestJudgeProgramBuild =
  vi.fn<(input: TestJudgeProgramBuildInput) => Promise<void>>();

const checkerPointer = storagePointerFor(
  "problems/checker-fixture/checker.cpp",
  Buffer.from("int main() {}\n"),
);
const interactorPointer = storagePointerFor(
  "problems/interactor-fixture/interactor.cpp",
  Buffer.from("int main() {}\n"),
);
const checkerCases = [{ input: "1 2\n", expectedOutput: "3\n", output: "3\n" }];
const checkerRequest = {
  kind: "checker",
  context: { type: "practice" },
  cases: checkerCases,
} satisfies TestJudgeRequest;
const wasmArtifact = { kind: "wasm" as const, bytes: { base64: "AGFzbQ==" }, language: "cpp" };

function interactiveRequest(
  language: "cpp" | "javascript",
  artifact: typeof wasmArtifact = wasmArtifact,
): TestJudgeRequest {
  return {
    kind: "interactive",
    context: { type: "practice" },
    language,
    artifact,
    cases: [{ interactorInput: "42\n" }],
  };
}

async function buildStudent() {
  const user = await createTestUser({ platformRole: "student" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: "student" as const,
  };
}

function checkerProblem() {
  return createTestProblem({
    judgeConfig: {
      type: "checker",
      checkerLanguage: "cpp",
      runtime: { env: { MODE: "strict" } },
    },
    checkerStorage: checkerPointer,
    timeLimitMs: 2000,
    memoryLimitMb: 128,
  });
}

function interactiveProblem(interactorLanguage: "cpp" | "python" = "cpp") {
  return createTestProblem({
    judgeConfig: { type: "interactive", interactorLanguage },
    interactorStorage: interactorPointer,
  });
}

async function pendingRequests() {
  return listByPrefix(createStorageClient(), TEST_JUDGE_REQUEST_PREFIX);
}

async function storedRequest(requestKey: string): Promise<unknown> {
  return JSON.parse(await getText(createStorageClient(), requestKey));
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the promise to reject.");
}

beforeEach(() => {
  vi.stubEnv("TEST_JUDGE_ENABLED", "true");
  runTestJudge.mockReset();
  dispatchTestJudgeProgramBuild.mockReset().mockResolvedValue(undefined);
  configureDomainOrchestration({ runTestJudge, dispatchTestJudgeProgramBuild } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("testJudgeDomain.runTestJudge", () => {
  it("stores the checker request, awaits the workflow and deletes the request", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    const seen: unknown[] = [];
    runTestJudge.mockImplementation(async ({ requestKey }) => {
      seen.push(await storedRequest(requestKey));
      return { ok: true, cases: [{ verdict: "AC", teamMessage: "ok", timeMs: 3 }] };
    });

    const response = await testJudgeDomain.runTestJudge(
      student,
      problem.id,
      checkerRequest,
      "127.0.0.1",
    );

    expect(response).toEqual({ cases: [{ verdict: "AC", teamMessage: "ok", timeMs: 3 }] });
    expect(runTestJudge).toHaveBeenCalledWith(
      {
        requestKey: expect.stringMatching(
          new RegExp(`^${TEST_JUDGE_REQUEST_PREFIX}[0-9a-f-]{36}\\.json$`),
        ),
      },
      { timeoutMs: 30_000 },
    );
    expect(seen).toEqual([
      {
        kind: "checker",
        judgeLanguage: "cpp",
        judgeScriptPointer: checkerPointer,
        timeLimitMs: 2000,
        memoryLimitMb: 128,
        runtimeEnv: { MODE: "strict" },
        cases: checkerCases,
      },
    ]);
    expect(await pendingRequests()).toEqual([]);
  });

  it("stores the interactive request with the contestant language and artifact", async () => {
    const student = await buildStudent();
    const problem = await interactiveProblem();
    const seen: unknown[] = [];
    runTestJudge.mockImplementation(async ({ requestKey }) => {
      seen.push(await storedRequest(requestKey));
      return { ok: true, cases: [{ verdict: "WA" }] };
    });

    await expect(
      testJudgeDomain.runTestJudge(student, problem.id, interactiveRequest("cpp"), "127.0.0.1"),
    ).resolves.toEqual({ cases: [{ verdict: "WA" }] });
    expect(seen).toEqual([
      {
        kind: "interactive",
        judgeLanguage: "cpp",
        judgeScriptPointer: interactorPointer,
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        runtimeEnv: {},
        contestantLanguage: "cpp",
        artifact: wasmArtifact,
        cases: [{ interactorInput: "42\n" }],
      },
    ]);
  });

  it("rejects a request whose kind differs from the judge type", async () => {
    const student = await buildStudent();
    const checker = await checkerProblem();
    const standard = await createTestProblem();

    await expect(
      testJudgeDomain.runTestJudge(student, checker.id, interactiveRequest("cpp"), "127.0.0.1"),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      testJudgeDomain.runTestJudge(student, standard.id, checkerRequest, "127.0.0.1"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTestJudge).not.toHaveBeenCalled();
    expect(await pendingRequests()).toEqual([]);
  });

  it("rejects an exam context without an active session and writes nothing", async () => {
    const student = await buildStudent();
    const owner = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: owner.id });
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.userId, role: "student", status: "active" },
    });
    const now = Date.now();
    const exam = await createTestExam({
      courseId: course.id,
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 60 * 60_000),
    });
    const problem = await checkerProblem();
    await testPrisma.examProblem.create({
      data: { examId: exam.id, problemId: problem.id, ordinal: 1, points: 100 },
    });

    await expect(
      testJudgeDomain.runTestJudge(
        student,
        problem.id,
        { ...checkerRequest, context: { type: "exam", examId: exam.id } },
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(runTestJudge).not.toHaveBeenCalled();
    expect(await pendingRequests()).toEqual([]);
  });

  it("is unavailable while the test judge is disabled", async () => {
    vi.stubEnv("TEST_JUDGE_ENABLED", "false");
    const student = await buildStudent();
    const problem = await checkerProblem();

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).toBe("test_judge_unavailable");
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("maps a busy workflow to 503 and still deletes the request", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    const pendingDuringRun: string[][] = [];
    runTestJudge.mockImplementation(async () => {
      pendingDuringRun.push(await pendingRequests());
      return { ok: false, code: "test_judge_busy" };
    });

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).toBe("test_judge_busy");
    expect(pendingDuringRun[0]).toHaveLength(1);
    expect(await pendingRequests()).toEqual([]);
  });

  it("maps an orchestration failure to unavailable and deletes the request", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    runTestJudge.mockRejectedValue(new Error("connection refused"));

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).toBe("test_judge_unavailable");
    expect(await pendingRequests()).toEqual([]);
  });

  it("reports a judge program build failure without its diagnostics", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    runTestJudge.mockResolvedValue({
      ok: false,
      code: "judge_program_build_failed",
      detail: "checker.cpp:1: error: secret_answer_table",
    });

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("judge_program_build_failed");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("secret_answer_table");
  });

  it("refuses interactive Test for unsupported contestant languages", async () => {
    const student = await buildStudent();
    const problem = await interactiveProblem();

    const error = await rejection(
      testJudgeDomain.runTestJudge(
        student,
        problem.id,
        interactiveRequest("javascript", { ...wasmArtifact, language: "javascript" }),
        "127.0.0.1",
      ),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("judge_program_unsupported");
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("refuses Python interactors", async () => {
    const student = await buildStudent();
    const problem = await interactiveProblem("python");

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, interactiveRequest("cpp"), "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("judge_program_unsupported");
  });

  it("rejects an artifact compiled for a different language", async () => {
    const student = await buildStudent();
    const problem = await interactiveProblem();

    await expect(
      testJudgeDomain.runTestJudge(
        student,
        problem.id,
        interactiveRequest("cpp", { ...wasmArtifact, language: "python" }),
        "127.0.0.1",
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(runTestJudge).not.toHaveBeenCalled();
  });

  it("refuses a checker problem without a stored checker", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem({
      judgeConfig: { type: "checker", checkerLanguage: "cpp" },
    });

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toBe("judge_program_unsupported");
  });
});

describe("judge program prebuild on judge config save", () => {
  async function draftProblem() {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const problem = await createTestProblem({
      authorId: teacher.id,
      status: "draft",
      visibility: "private",
    });
    const actor = {
      userId: teacher.id,
      username: teacher.username,
      platformRole: teacher.platformRole,
    };
    return { actor, problem };
  }

  it("dispatches the checker build with its role, language and pointer", async () => {
    const { actor, problem } = await draftProblem();

    await problemDomain.setProblemChecker(actor, problem.id, {
      content: "print('ok')\n",
      language: "python",
    });

    const row = await testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
    expect(dispatchTestJudgeProgramBuild).toHaveBeenCalledWith({
      role: "checker",
      language: "python",
      scriptPointer: assertStorageObjectPointer(row.checkerStorage),
    });
  });

  it("does not dispatch while the test judge is disabled", async () => {
    vi.stubEnv("TEST_JUDGE_ENABLED", "false");
    const { actor, problem } = await draftProblem();

    await problemDomain.setProblemChecker(actor, problem.id, {
      content: "print('ok')\n",
      language: "python",
    });

    expect(dispatchTestJudgeProgramBuild).not.toHaveBeenCalled();
  });

  it("keeps the save when the dispatch fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    dispatchTestJudgeProgramBuild.mockRejectedValue(new Error("temporal down"));
    const { actor, problem } = await draftProblem();

    await expect(
      problemDomain.setProblemInteractor(actor, problem.id, {
        content: "int main() {}\n",
        language: "cpp",
      }),
    ).resolves.toEqual({ id: problem.id });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    const row = await testPrisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
    expect(row.judgeConfig).toMatchObject({ type: "interactive", interactorLanguage: "cpp" });
    expect(dispatchTestJudgeProgramBuild).toHaveBeenCalledWith({
      role: "interactor",
      language: "cpp",
      scriptPointer: assertStorageObjectPointer(row.interactorStorage),
    });
  });
});

describe("problem detail test capability", () => {
  async function capabilityOf(overrides: Parameters<typeof createTestProblem>[0]) {
    const problem = await createTestProblem(overrides);
    return (await problemDomain.getProblemPageData(problem.id)).testCapability;
  }

  it("reports the static Test capability per judge setup", async () => {
    expect(await capabilityOf({})).toEqual({ available: true });
    expect(await capabilityOf({ type: "special_env" })).toEqual({
      available: false,
      reason: "special_env",
    });
    expect(
      await capabilityOf({ judgeConfig: { type: "checker", checkerLanguage: "cpp" } }),
    ).toEqual({ available: true });
    expect(
      await capabilityOf({
        judgeConfig: { type: "interactive", interactorLanguage: "python" },
      }),
    ).toEqual({ available: false, reason: "judge_program_unsupported" });
  });

  it("reports checker Test as unavailable while the test judge is disabled", async () => {
    vi.stubEnv("TEST_JUDGE_ENABLED", "false");

    expect(
      await capabilityOf({ judgeConfig: { type: "checker", checkerLanguage: "cpp" } }),
    ).toEqual({ available: false, reason: "test_judge_unavailable" });
    expect(await capabilityOf({})).toEqual({ available: true });
  });
});
