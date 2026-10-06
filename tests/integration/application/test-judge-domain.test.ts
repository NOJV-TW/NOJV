import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
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
  createTestContest,
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

function actorOf(user: Awaited<ReturnType<typeof createTestUser>>) {
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole,
  };
}

async function buildStudent() {
  return actorOf(await createTestUser({ platformRole: "student" }));
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
    const failure = new Error("connection refused");
    runTestJudge.mockRejectedValue(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const error = await rejection(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).toBe("test_judge_unavailable");
    expect(warn).toHaveBeenCalledWith("Test-judge workflow failed", {
      requestKey: runTestJudge.mock.calls[0]?.[0].requestKey,
      error: failure,
    });
    expect(await pendingRequests()).toEqual([]);
  });

  it("maps an unknown workflow code to unavailable", async () => {
    const student = await buildStudent();
    const problem = await checkerProblem();
    runTestJudge.mockResolvedValue({ ok: false, code: "unheard_of" } as never);

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

describe("problem context authorisation", () => {
  const minutes = (count: number) => new Date(Date.now() + count * 60_000);

  beforeEach(() => {
    runTestJudge.mockResolvedValue({ ok: true, cases: [{ verdict: "AC" }] });
  });

  async function expectRefused(
    attempt: Promise<unknown>,
    errorType: typeof ForbiddenError | typeof NotFoundError,
  ) {
    await expect(attempt).rejects.toBeInstanceOf(errorType);
    expect(runTestJudge).not.toHaveBeenCalled();
    expect(await pendingRequests()).toEqual([]);
  }

  async function contestWithProblem(startsAt: Date, endsAt: Date) {
    const organizer = await createTestUser({ platformRole: "teacher" });
    const contest = await createTestContest({
      createdByUserId: organizer.id,
      startsAt,
      endsAt,
    });
    const problem = await checkerProblem();
    await testPrisma.contestProblem.create({
      data: { contestId: contest.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    const request = { ...checkerRequest, context: { type: "contest", contestId: contest.id } };
    return { organizer: actorOf(organizer), contest, problem, request } as const;
  }

  async function joinContest(contestId: string, userId: string) {
    await testPrisma.participation.create({
      data: { type: "contest", contestId, userId, status: "active" },
    });
  }

  it("lets a contest participant Test while the contest runs", async () => {
    const student = await buildStudent();
    const { contest, problem, request } = await contestWithProblem(minutes(-1), minutes(60));
    await joinContest(contest.id, student.userId);

    await expect(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
    ).resolves.toEqual({ cases: [{ verdict: "AC" }] });
  });

  it("refuses a student who is not participating in the contest", async () => {
    const student = await buildStudent();
    const { problem, request } = await contestWithProblem(minutes(-1), minutes(60));

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
      ForbiddenError,
    );
  });

  it("refuses a participant once the contest has ended", async () => {
    const student = await buildStudent();
    const { contest, problem, request } = await contestWithProblem(minutes(-120), minutes(-1));
    await joinContest(contest.id, student.userId);

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
      ForbiddenError,
    );
  });

  it("lets the contest organizer Test outside the contest window", async () => {
    const { organizer, problem, request } = await contestWithProblem(
      minutes(-120),
      minutes(-1),
    );

    await expect(
      testJudgeDomain.runTestJudge(organizer, problem.id, request, "127.0.0.1"),
    ).resolves.toEqual({ cases: [{ verdict: "AC" }] });
  });

  async function assignmentWithProblem() {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const course = await createTestCourse({ ownerId: teacher.id });
    const assessment = await testPrisma.assessment.create({
      data: {
        courseId: course.id,
        createdByUserId: teacher.id,
        title: "HW",
        summary: "Open",
        status: "published",
        opensAt: minutes(-60),
        closesAt: minutes(60),
      },
    });
    const problem = await checkerProblem();
    await testPrisma.assessmentProblem.create({
      data: { assessmentId: assessment.id, problemId: problem.id, ordinal: 1, points: 100 },
    });
    const request = {
      ...checkerRequest,
      context: { type: "assignment", courseId: course.id, assessmentId: assessment.id },
    } as const;
    return { course, problem, request };
  }

  it("lets an enrolled student Test an assignment problem", async () => {
    const student = await buildStudent();
    const { course, problem, request } = await assignmentWithProblem();
    await testPrisma.courseMembership.create({
      data: { courseId: course.id, userId: student.userId, role: "student", status: "active" },
    });

    await expect(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
    ).resolves.toEqual({ cases: [{ verdict: "AC" }] });
  });

  it("refuses an assignment problem to a student outside the course", async () => {
    const student = await buildStudent();
    const { problem, request } = await assignmentWithProblem();

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
      ForbiddenError,
    );
  });

  it("hides a private practice problem the student cannot view", async () => {
    const student = await buildStudent();
    const problem = await createTestProblem({
      visibility: "private",
      judgeConfig: { type: "checker", checkerLanguage: "cpp" },
      checkerStorage: checkerPointer,
    });

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, checkerRequest, "127.0.0.1"),
      NotFoundError,
    );
  });

  async function virtualRun(owner: string, endsAt: Date) {
    const { contest, problem } = await contestWithProblem(minutes(-180), minutes(-120));
    const virtual = await testPrisma.participation.create({
      data: {
        type: "virtual",
        contestId: contest.id,
        userId: owner,
        status: "active",
        startedAt: new Date(endsAt.getTime() - 60 * 60_000),
        endsAt,
      },
    });
    const request = {
      ...checkerRequest,
      context: { type: "virtual", participationId: virtual.id },
    } as const;
    return { problem, request };
  }

  it("lets the owner Test during a virtual contest", async () => {
    const student = await buildStudent();
    const { problem, request } = await virtualRun(student.userId, minutes(60));

    await expect(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
    ).resolves.toEqual({ cases: [{ verdict: "AC" }] });
  });

  it("refuses someone else's virtual contest", async () => {
    const owner = await buildStudent();
    const student = await buildStudent();
    const { problem, request } = await virtualRun(owner.userId, minutes(60));

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
      NotFoundError,
    );
  });

  it("refuses a virtual contest whose timer has ended", async () => {
    const student = await buildStudent();
    const { problem, request } = await virtualRun(student.userId, minutes(-1));

    await expectRefused(
      testJudgeDomain.runTestJudge(student, problem.id, request, "127.0.0.1"),
      ForbiddenError,
    );
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
    expect(await capabilityOf({ judgeConfig: { type: "checker" } })).toEqual({
      available: false,
      reason: "judge_program_unsupported",
    });
  });

  it("reports checker Test as unavailable while the test judge is disabled", async () => {
    vi.stubEnv("TEST_JUDGE_ENABLED", "false");

    expect(
      await capabilityOf({ judgeConfig: { type: "checker", checkerLanguage: "cpp" } }),
    ).toEqual({ available: false, reason: "test_judge_unavailable" });
    expect(await capabilityOf({})).toEqual({ available: true });
  });
});
