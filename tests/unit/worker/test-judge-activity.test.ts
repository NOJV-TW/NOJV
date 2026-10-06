import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  serialiseBuildArtifact,
  TEST_JUDGE_MAX_ARTIFACT_BYTES,
  TEST_JUDGE_MAX_CASES,
  TEST_JUDGE_RESPONSE_BYTES,
  TEST_JUDGE_TRANSCRIPT_BYTES,
  type TestJudgeStoredRequest,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import { StorageIntegrityError } from "@nojv/storage";

import {
  buildTestJudgeProgram,
  runTestJudge,
  setTestJudgeDeps,
  type TestJudgeStorage,
} from "../../../apps/worker/src/activities/test-judge";
import type { JudgeProgram } from "../../../apps/worker/src/test-judge/judge-program";
import type { TestJudgeEngine } from "../../../apps/worker/src/test-judge/runtime";

vi.mock("../../../apps/worker/src/logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type BuildArtifact = Extract<JudgeProgram, { ok: true }>["artifact"];
type BuildResult = Awaited<ReturnType<TestJudgeEngine["compile"]>>;
type RunResult = Awaited<ReturnType<TestJudgeEngine["run"]>>;
type InteractResult = Awaited<ReturnType<TestJudgeEngine["interact"]>>;
type RunOptions = Parameters<TestJudgeEngine["run"]>[1];
type InteractOptions = Parameters<TestJudgeEngine["interact"]>[2];

const REQUEST_KEY = "test-judge-requests/req-1.json";
const TEAM_MESSAGE = "/judge/feedback/teammessage.txt";
const MIB = 1024 * 1024;

const judgeArtifact: BuildArtifact = {
  wasmOjContract: 2,
  id: "judge",
  projectId: "sdk:main",
  cacheKey: "cache-key",
  name: "main",
  target: "wasip1",
  optimization: "release",
  createdAt: 1,
  durationMs: 2,
  toolchains: ["clang@0.2.0"],
  costProfile: "profile",
  kind: "wasm",
  language: "cpp",
  size: 4,
  bytes: new Uint8Array([0, 97, 115, 109]),
};

const contestantArtifact: BuildArtifact = { ...judgeArtifact, id: "contestant" };

const baseRequest = {
  judgeLanguage: "cpp" as const,
  judgeScriptPointer: { key: "problems/p1/checker.cpp", sha256: "a".repeat(64), size: 12 },
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  runtimeEnv: { MODE: "test" },
};

function checkerRequest(outputs: string[]): TestJudgeStoredRequest {
  return {
    kind: "checker",
    ...baseRequest,
    cases: outputs.map((output) => ({ input: "2 3\n", expectedOutput: "5\n", output })),
  };
}

function interactiveRequest(
  overrides: Partial<Extract<TestJudgeStoredRequest, { kind: "interactive" }>> = {},
): TestJudgeStoredRequest {
  return {
    kind: "interactive",
    ...baseRequest,
    contestantLanguage: "python",
    artifact: serialiseBuildArtifact(contestantArtifact),
    cases: [{ interactorInput: "37\n" }],
    ...overrides,
  };
}

const metrics = {
  cost: null,
  rawCost: null,
  baselineCost: 0,
  costProfile: "profile",
  costModel: "model",
  operations: null,
  memoryBytes: null,
  logicalTimeNs: null,
  filesystemBytes: null,
  filesystemEntries: null,
  stdoutBytes: null,
  stderrBytes: null,
};

function runResult(code: number, files: Record<string, string> = {}): RunResult {
  return {
    code,
    termination: "exited",
    stdout: "",
    stderr: "",
    files: Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]),
    ),
    metrics,
  } as unknown as RunResult;
}

function interactResult(overrides: {
  contestant?: Partial<InteractResult["contestant"]>;
  interactor?: Partial<InteractResult["interactor"]>;
  contestantToInteractor?: string;
  interactorToContestant?: string;
}): InteractResult {
  return {
    contestant: {
      code: 0,
      termination: "exited",
      stderr: "",
      metrics,
      ...overrides.contestant,
    },
    interactor: {
      code: 42,
      termination: "exited",
      stderr: "",
      metrics,
      ...overrides.interactor,
    },
    contestantToInteractor: overrides.contestantToInteractor ?? "50\n",
    interactorToContestant: overrides.interactorToContestant ?? "lower\n",
  } as unknown as InteractResult;
}

const BUSY = { ok: false, code: "test_judge_busy" };

const wallStopped = {
  contestant: { code: 137, termination: "wall-time-limit" as const },
  interactor: { code: 137, termination: "wall-time-limit" as const },
};

function buildResult(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    success: true,
    artifact: judgeArtifact,
    diagnostics: [],
    stdout: "",
    stderr: "",
    cacheHit: false,
    ...overrides,
  };
}

function setup(request: TestJudgeStoredRequest | string | null) {
  const blobs = new Map<string, string>();
  if (request !== null) {
    blobs.set(REQUEST_KEY, typeof request === "string" ? request : JSON.stringify(request));
  }
  const storage = {
    getText: vi.fn(async (key: string) => {
      const body = blobs.get(key);
      if (body === undefined) throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return body;
    }),
    getVerifiedText: vi.fn(
      async (_pointer: Parameters<TestJudgeStorage["getVerifiedText"]>[0]) =>
        "int main() { return 42; }\n",
    ),
    deleteBlob: vi.fn(async (key: string) => {
      blobs.delete(key);
    }),
  } satisfies TestJudgeStorage;
  const engine = {
    compile: vi.fn(async (_input: Parameters<TestJudgeEngine["compile"]>[0]) => buildResult()),
    run: vi.fn(async (_artifact: BuildArtifact, _options?: RunOptions) => runResult(42)),
    interact: vi.fn(
      async (
        _contestant: BuildArtifact,
        _interactor: BuildArtifact,
        _options?: InteractOptions,
      ) => interactResult({}),
    ),
    cancel: vi.fn(),
  };
  const release = vi.fn();
  const pool = { acquire: vi.fn(async () => ({ engine, release })) };
  const programs = new Map<string, string>();
  const programStore = {
    get: async (key: string) => programs.get(key) ?? null,
    put: vi.fn(async (key: string, body: string) => {
      programs.set(key, body);
    }),
  };
  setTestJudgeDeps({ pool, storage, programs: programStore });
  return { blobs, storage, engine, pool, release, programStore };
}

function activity(scheduledTimestampMs = Date.now()) {
  return new MockActivityEnvironment({ scheduledTimestampMs });
}

function judge(
  requestKey = REQUEST_KEY,
  environment = activity(),
): Promise<TestJudgeWorkflowOutput> {
  return environment.run(runTestJudge, { requestKey });
}

function pendingUntilCancelled(engine: ReturnType<typeof setup>["engine"]) {
  return () =>
    new Promise<never>((_resolve, reject) => {
      engine.cancel.mockImplementationOnce(() =>
        reject(new Error("Server execution was cancelled.")),
      );
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runTestJudge checker requests", () => {
  it("returns AC with the team message and never the judge message", async () => {
    const { engine, blobs, release } = setup(checkerRequest(["5\n"]));
    engine.run.mockResolvedValue(
      runResult(42, { [TEAM_MESSAGE]: "sum ok", "/judge/feedback/judgemessage.txt": "staff" }),
    );

    const output = await judge();

    expect(output).toEqual({ ok: true, cases: [{ verdict: "AC", teamMessage: "sum ok" }] });
    expect(JSON.stringify(output)).not.toContain("staff");
    expect(engine.run).toHaveBeenCalledWith(judgeArtifact, {
      args: ["/judge/input", "/judge/answer", "/judge/feedback"],
      stdin: "5\n",
      env: {},
      files: { "/judge/input": "2 3\n", "/judge/answer": "5\n", "/judge/feedback/.keep": "" },
      outputPaths: [TEAM_MESSAGE],
      resources: {
        logicalTimeLimitMs: 30_000,
        memoryLimitBytes: 512 * MIB,
        wallTimeLimitMs: 10_000,
      },
    });
    expect(blobs.has(REQUEST_KEY)).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns WA when the checker exits 43", async () => {
    const { engine } = setup(checkerRequest(["6\n"]));
    engine.run.mockResolvedValue(runResult(43, { [TEAM_MESSAGE]: "expected 5" }));

    await expect(judge()).resolves.toEqual({
      ok: true,
      cases: [{ verdict: "WA", teamMessage: "expected 5" }],
    });
  });

  it("marks only the case whose engine call throws as SE", async () => {
    const { engine } = setup(checkerRequest(["5\n", "5\n"]));
    engine.run.mockRejectedValueOnce(new Error("runner crashed: /secret/path"));

    await expect(judge()).resolves.toEqual({
      ok: true,
      cases: [{ verdict: "SE" }, { verdict: "AC" }],
    });
  });

  it("reports busy when the 24 s budget runs out before every case and caps wall time to the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { engine } = setup(checkerRequest(["5\n", "5\n", "5\n"]));
    const elapsed = [16_000, 8_000];
    engine.run.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + (elapsed.shift() ?? 0));
      return runResult(42);
    });

    const output = await judge();

    expect(output).toEqual(BUSY);
    expect(
      engine.run.mock.calls.map(([, options]) => options?.resources?.wallTimeLimitMs),
    ).toEqual([10_000, 8_000]);
  });

  it("reports busy when a checker is stopped at a wall stop the budget shortened", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { engine } = setup(checkerRequest(["5\n"]));
    engine.run.mockResolvedValue({ ...runResult(137), termination: "wall-time-limit" });

    await expect(judge(REQUEST_KEY, activity(Date.now() - 20_000))).resolves.toEqual(BUSY);
  });

  it("reports SE when a checker is stopped at its full wall stop", async () => {
    const { engine } = setup(checkerRequest(["5\n"]));
    engine.run.mockResolvedValue({ ...runResult(137), termination: "wall-time-limit" });

    await expect(judge()).resolves.toEqual({ ok: true, cases: [{ verdict: "SE" }] });
  });

  it("anchors the budget to when the activity was scheduled", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { engine } = setup(checkerRequest(["5\n"]));

    await judge(REQUEST_KEY, activity(Date.now() - 20_000));

    expect(engine.run.mock.calls[0]?.[1]?.resources?.wallTimeLimitMs).toBe(4_000);
  });

  it("cancels the engine at the deadline and reports busy", async () => {
    const { engine, release } = setup(checkerRequest(["5\n", "5\n"]));
    engine.run.mockImplementationOnce(pendingUntilCancelled(engine));

    const output = await judge(REQUEST_KEY, activity(Date.now() - 23_950));

    expect(output).toEqual(BUSY);
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.run).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("cancels the engine and reports busy when the activity is cancelled", async () => {
    const { engine } = setup(checkerRequest(["5\n", "5\n"]));
    const environment = activity();
    engine.run.mockImplementationOnce(() => {
      const pending = pendingUntilCancelled(engine)();
      environment.cancel();
      return pending;
    });

    const output = await judge(REQUEST_KEY, environment);

    expect(output).toEqual(BUSY);
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.run).toHaveBeenCalledOnce();
  });

  it("reports busy without building once the activity is already cancelled", async () => {
    const { engine, release } = setup(checkerRequest(["5\n", "5\n"]));
    const environment = activity();
    environment.cancel();

    await expect(judge(REQUEST_KEY, environment)).resolves.toEqual(BUSY);
    expect(engine.compile).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not cache a judge program build interrupted by cancellation", async () => {
    const { engine, programStore } = setup(checkerRequest(["5\n"]));
    const environment = activity();
    engine.compile.mockImplementationOnce(() => {
      const pending = pendingUntilCancelled(engine)();
      environment.cancel();
      return pending;
    });

    await expect(judge(REQUEST_KEY, environment)).resolves.toEqual(BUSY);
    expect(programStore.put).not.toHaveBeenCalled();
  });

  it("reports a judge program build failure without its diagnostics", async () => {
    const { engine, blobs } = setup(checkerRequest(["5\n"]));
    engine.compile.mockResolvedValue(
      buildResult({ success: false, artifact: undefined, stderr: "main.cpp:1: secret_token" }),
    );

    await expect(judge()).resolves.toEqual({ ok: false, code: "judge_program_build_failed" });
    expect(engine.run).not.toHaveBeenCalled();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });
});

describe("runTestJudge interactive requests", () => {
  it("runs the contestant on the problem limits and returns the transcript", async () => {
    const { engine } = setup(interactiveRequest());
    engine.interact.mockResolvedValue(
      interactResult({
        contestant: {
          stderr: "debug line",
          metrics: { ...metrics, logicalTimeNs: 1_200_001 },
        },
        interactor: { stderr: "interactor secret" },
      }),
    );

    const output = await judge();

    expect(output).toEqual({
      ok: true,
      cases: [
        {
          verdict: "AC",
          contestantStderr: "debug line",
          transcript: { toInteractor: "50\n", toContestant: "lower\n" },
          timeMs: 2,
        },
      ],
    });
    expect(JSON.stringify(output)).not.toContain("interactor secret");
    const [contestant, interactor, options] = engine.interact.mock.calls[0]!;
    expect(contestant).toEqual(contestantArtifact);
    expect(interactor).toEqual(judgeArtifact);
    expect(options).toEqual({
      contestant: {
        env: { MODE: "test" },
        resources: {
          logicalTimeLimitMs: 3000,
          memoryLimitBytes: 256 * MIB,
          outputLimitBytes: 16 * MIB,
          filesystemWriteLimitBytes: 64 * MIB,
          filesystemEntryLimit: 4096,
          wallTimeLimitMs: 9000,
        },
      },
      interactor: {
        args: ["/judge/input", "/judge/answer", "/judge/feedback"],
        files: { "/judge/input": "37\n", "/judge/answer": "", "/judge/feedback/.keep": "" },
        resources: {
          logicalTimeLimitMs: 30_000,
          memoryLimitBytes: 512 * MIB,
          wallTimeLimitMs: 9000,
        },
      },
    });
  });

  it("keeps the whole response within the Temporal payload budget", async () => {
    const { engine } = setup(
      interactiveRequest({
        cases: Array.from({ length: TEST_JUDGE_MAX_CASES }, () => ({
          interactorInput: "37\n",
        })),
      }),
    );
    const control = "\u0001".repeat(200_000);
    engine.interact.mockResolvedValue(
      interactResult({
        contestant: { stderr: control },
        contestantToInteractor: control,
        interactorToContestant: control,
      }),
    );

    const output = await judge();

    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThanOrEqual(
      TEST_JUDGE_RESPONSE_BYTES,
    );
    expect(output.ok && output.cases.map(({ verdict }) => verdict)).toEqual(
      Array.from({ length: TEST_JUDGE_MAX_CASES }, () => "AC"),
    );
  });

  it("gives a short time limit a 3 s wall stop", async () => {
    const { engine } = setup(interactiveRequest({ contestantLanguage: "cpp" }));

    await judge();

    expect(engine.interact.mock.calls[0]?.[2]?.contestant?.resources?.wallTimeLimitMs).toBe(
      3000,
    );
  });

  it("lets a contestant TLE win over the interactor's WA", async () => {
    const { engine } = setup(interactiveRequest());
    engine.interact.mockResolvedValue(
      interactResult({
        contestant: { code: 137, termination: "logical-time-limit" },
        interactor: { code: 43 },
      }),
    );

    const output = await judge();

    expect(output.ok && output.cases[0]?.verdict).toBe("TLE");
  });

  it("reports TLE when the full wall stop ends both programs", async () => {
    const { engine } = setup(interactiveRequest());
    engine.interact.mockResolvedValue(interactResult(wallStopped));

    const output = await judge();

    expect(output.ok && output.cases[0]?.verdict).toBe("TLE");
  });

  it("reports busy when a wall stop cut short by the request budget ends the case", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { engine } = setup(interactiveRequest());
    engine.interact.mockResolvedValue(interactResult(wallStopped));

    const output = await judge(REQUEST_KEY, activity(Date.now() - 20_000));

    expect(engine.interact.mock.calls[0]?.[2]?.contestant?.resources?.wallTimeLimitMs).toBe(
      4000,
    );
    expect(output).toEqual(BUSY);
  });

  it("truncates the transcript to the transcript cap", async () => {
    const { engine } = setup(interactiveRequest());
    const long = "é".repeat(TEST_JUDGE_TRANSCRIPT_BYTES);
    engine.interact.mockResolvedValue(
      interactResult({ contestantToInteractor: long, interactorToContestant: long }),
    );

    const output = await judge();

    const transcript = output.ok ? output.cases[0]?.transcript : undefined;
    expect(new TextEncoder().encode(transcript?.toInteractor).byteLength).toBe(
      TEST_JUDGE_TRANSCRIPT_BYTES,
    );
    expect(new TextEncoder().encode(transcript?.toContestant).byteLength).toBe(
      TEST_JUDGE_TRANSCRIPT_BYTES,
    );
  });

  it("marks every case SE for an oversized Wasm artifact without using an engine", async () => {
    const { pool, blobs } = setup(
      interactiveRequest({
        artifact: {
          ...serialiseBuildArtifact(contestantArtifact),
          bytes: { base64: Buffer.alloc(TEST_JUDGE_MAX_ARTIFACT_BYTES + 1).toString("base64") },
        },
        cases: [{ interactorInput: "1\n" }, { interactorInput: "2\n" }],
      }),
    );

    await expect(judge()).resolves.toEqual({
      ok: true,
      cases: [{ verdict: "SE" }, { verdict: "SE" }],
    });
    expect(pool.acquire).not.toHaveBeenCalled();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("accepts a Wasm artifact of exactly the maximum size", async () => {
    const { engine } = setup(
      interactiveRequest({
        artifact: {
          ...serialiseBuildArtifact(contestantArtifact),
          bytes: { base64: Buffer.alloc(TEST_JUDGE_MAX_ARTIFACT_BYTES).toString("base64") },
        },
      }),
    );

    await judge();

    expect(engine.interact).toHaveBeenCalledOnce();
  });

  it("refuses a Python interactor", async () => {
    const { pool } = setup(interactiveRequest({ judgeLanguage: "python" }));

    await expect(judge()).resolves.toEqual({ ok: false, code: "judge_program_unsupported" });
    expect(pool.acquire).not.toHaveBeenCalled();
  });
});

describe("runTestJudge request handling", () => {
  it.each([
    ["missing", null],
    ["unparseable", "{not json"],
    ["invalid", JSON.stringify({ kind: "checker" })],
  ])("reports a %s request blob as unavailable and deletes it", async (_label, body) => {
    const { storage, pool } = setup(body);

    await expect(judge()).resolves.toEqual({ ok: false, code: "test_judge_unavailable" });
    expect(storage.deleteBlob).toHaveBeenCalledWith(REQUEST_KEY);
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it("neither reads nor deletes a key outside the request prefix", async () => {
    const { storage } = setup(checkerRequest(["5\n"]));

    await expect(judge("problems/p1/checker.cpp")).resolves.toEqual({
      ok: false,
      code: "test_judge_unavailable",
    });
    expect(storage.getText).not.toHaveBeenCalled();
    expect(storage.deleteBlob).not.toHaveBeenCalled();
  });

  it("reports a judge program source that fails its integrity check as unavailable", async () => {
    const { storage, pool, blobs } = setup(checkerRequest(["5\n"]));
    storage.getVerifiedText.mockRejectedValue(
      new StorageIntegrityError("problems/p1/checker.cpp", "SHA-256 mismatch"),
    );

    await expect(judge()).resolves.toEqual({ ok: false, code: "test_judge_unavailable" });
    expect(pool.acquire).not.toHaveBeenCalled();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("throws a transient judge program source read failure", async () => {
    const { storage, pool, blobs } = setup(checkerRequest(["5\n"]));
    storage.getVerifiedText.mockRejectedValue(new Error("socket hang up"));

    await expect(judge()).rejects.toThrow("socket hang up");
    expect(pool.acquire).not.toHaveBeenCalled();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("releases the engine and deletes the blob when the judge program build throws", async () => {
    const { engine, release, blobs } = setup(checkerRequest(["5\n"]));
    engine.compile.mockRejectedValue(new Error("compiler crashed"));

    await expect(judge()).rejects.toThrow("compiler crashed");
    expect(release).toHaveBeenCalledOnce();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("keeps the result when deleting the blob fails", async () => {
    const { storage } = setup(checkerRequest(["5\n"]));
    storage.deleteBlob.mockRejectedValue(new Error("storage down"));

    await expect(judge()).resolves.toEqual({ ok: true, cases: [{ verdict: "AC" }] });
  });
});

describe("buildTestJudgeProgram", () => {
  const input = {
    role: "interactor" as const,
    language: "cpp" as const,
    scriptPointer: baseRequest.judgeScriptPointer,
  };

  it("compiles the judge program from its pointer and releases the engine", async () => {
    const { storage, engine, release } = setup(null);

    await buildTestJudgeProgram(input);

    expect(storage.getVerifiedText).toHaveBeenCalledWith(input.scriptPointer);
    expect(engine.compile).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns a cached program without acquiring an engine", async () => {
    const { engine, pool } = setup(null);
    await buildTestJudgeProgram(input);
    pool.acquire.mockClear();

    await buildTestJudgeProgram(input);

    expect(pool.acquire).not.toHaveBeenCalled();
    expect(engine.compile).toHaveBeenCalledOnce();
  });

  it("rebuilds under a lease when the cached record is unreadable", async () => {
    const { engine, pool, programStore } = setup(null);
    await buildTestJudgeProgram(input);
    const [key] = programStore.put.mock.calls[0] ?? [];
    await programStore.put(String(key), "not json");
    pool.acquire.mockClear();

    await buildTestJudgeProgram(input);

    expect(pool.acquire).toHaveBeenCalledOnce();
    expect(engine.compile).toHaveBeenCalledTimes(2);
  });

  it("throws on storage errors so Temporal retries", async () => {
    const { storage, pool } = setup(null);
    storage.getVerifiedText.mockRejectedValue(new Error("integrity failure"));

    await expect(buildTestJudgeProgram(input)).rejects.toThrow("integrity failure");
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it("throws when the built program cannot be cached", async () => {
    const { programStore, release } = setup(null);
    programStore.put.mockRejectedValue(new Error("bucket unavailable"));

    await expect(buildTestJudgeProgram(input)).rejects.toThrow("bucket unavailable");
    expect(release).toHaveBeenCalledOnce();
  });
});
