import { afterEach, describe, expect, it, vi } from "vitest";

import {
  serialiseBuildArtifact,
  TEST_JUDGE_MAX_ARTIFACT_BYTES,
  TEST_JUDGE_TRANSCRIPT_BYTES,
  type TestJudgeStoredRequest,
} from "@nojv/core";

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
    getVerifiedText: vi.fn(async () => "int main() { return 42; }\n"),
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
  };
  const release = vi.fn();
  const pool = { acquire: vi.fn(async () => ({ engine, release })) };
  const programs = new Map<string, string>();
  setTestJudgeDeps({
    pool,
    storage,
    programs: {
      get: async (key) => programs.get(key) ?? null,
      put: async (key, body) => {
        programs.set(key, body);
      },
    },
  });
  return { blobs, storage, engine, pool, release };
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

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

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
        memoryLimitBytes: 512 * 1024 * 1024,
        wallTimeLimitMs: 10_000,
      },
    });
    expect(blobs.has(REQUEST_KEY)).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("returns WA when the checker exits 43", async () => {
    const { engine } = setup(checkerRequest(["6\n"]));
    engine.run.mockResolvedValue(runResult(43, { [TEAM_MESSAGE]: "expected 5" }));

    await expect(runTestJudge({ requestKey: REQUEST_KEY })).resolves.toEqual({
      ok: true,
      cases: [{ verdict: "WA", teamMessage: "expected 5" }],
    });
  });

  it("marks only the case whose engine call throws as SE", async () => {
    const { engine } = setup(checkerRequest(["5\n", "5\n"]));
    engine.run.mockRejectedValueOnce(new Error("runner crashed: /secret/path"));

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

    expect(output).toEqual({ ok: true, cases: [{ verdict: "SE" }, { verdict: "AC" }] });
  });

  it("marks the cases left after the 24 s budget as SE and caps wall time to the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { engine } = setup(checkerRequest(["5\n", "5\n", "5\n"]));
    const elapsed = [16_000, 8_000];
    engine.run.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + (elapsed.shift() ?? 0));
      return runResult(42);
    });

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

    expect(output).toEqual({
      ok: true,
      cases: [{ verdict: "AC" }, { verdict: "AC" }, { verdict: "SE" }],
    });
    expect(
      engine.run.mock.calls.map(([, options]) => options?.resources?.wallTimeLimitMs),
    ).toEqual([10_000, 8_000]);
  });

  it("reports a judge program build failure without its diagnostics", async () => {
    const { engine, blobs } = setup(checkerRequest(["5\n"]));
    engine.compile.mockResolvedValue(
      buildResult({ success: false, artifact: undefined, stderr: "main.cpp:1: secret_token" }),
    );

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

    expect(output).toEqual({ ok: false, code: "judge_program_build_failed" });
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

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

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
          memoryLimitBytes: 256 * 1024 * 1024,
          outputLimitBytes: 16 * 1024 * 1024,
          filesystemWriteLimitBytes: 64 * 1024 * 1024,
          filesystemEntryLimit: 4096,
          wallTimeLimitMs: 10_000,
        },
      },
      interactor: {
        args: ["/judge/input", "/judge/answer", "/judge/feedback"],
        files: { "/judge/input": "37\n", "/judge/answer": "", "/judge/feedback/.keep": "" },
        resources: {
          logicalTimeLimitMs: 30_000,
          memoryLimitBytes: 512 * 1024 * 1024,
          wallTimeLimitMs: 10_000,
        },
      },
    });
  });

  it("lets a contestant TLE win over the interactor's WA", async () => {
    const { engine } = setup(interactiveRequest());
    engine.interact.mockResolvedValue(
      interactResult({
        contestant: { code: 137, termination: "logical-time-limit" },
        interactor: { code: 43 },
      }),
    );

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

    expect(output.ok && output.cases[0]?.verdict).toBe("TLE");
  });

  it("truncates the transcript to the transcript cap", async () => {
    const { engine } = setup(interactiveRequest());
    const long = "é".repeat(TEST_JUDGE_TRANSCRIPT_BYTES);
    engine.interact.mockResolvedValue(
      interactResult({ contestantToInteractor: long, interactorToContestant: long }),
    );

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

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

    const output = await runTestJudge({ requestKey: REQUEST_KEY });

    expect(output).toEqual({ ok: true, cases: [{ verdict: "SE" }, { verdict: "SE" }] });
    expect(pool.acquire).not.toHaveBeenCalled();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("refuses a Python interactor", async () => {
    const { pool } = setup(interactiveRequest({ judgeLanguage: "python" }));

    await expect(runTestJudge({ requestKey: REQUEST_KEY })).resolves.toEqual({
      ok: false,
      code: "judge_program_unsupported",
    });
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

    await expect(runTestJudge({ requestKey: REQUEST_KEY })).resolves.toEqual({
      ok: false,
      code: "test_judge_unavailable",
    });
    expect(storage.deleteBlob).toHaveBeenCalledWith(REQUEST_KEY);
    expect(pool.acquire).not.toHaveBeenCalled();
  });

  it("releases the engine and deletes the blob when the judge program build throws", async () => {
    const { engine, release, blobs } = setup(checkerRequest(["5\n"]));
    engine.compile.mockRejectedValue(new Error("compiler crashed"));

    await expect(runTestJudge({ requestKey: REQUEST_KEY })).rejects.toThrow("compiler crashed");
    expect(release).toHaveBeenCalledOnce();
    expect(blobs.has(REQUEST_KEY)).toBe(false);
  });

  it("keeps the result when deleting the blob fails", async () => {
    const { storage } = setup(checkerRequest(["5\n"]));
    storage.deleteBlob.mockRejectedValue(new Error("storage down"));

    await expect(runTestJudge({ requestKey: REQUEST_KEY })).resolves.toEqual({
      ok: true,
      cases: [{ verdict: "AC" }],
    });
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

  it("throws on storage errors so Temporal retries", async () => {
    const { storage, pool } = setup(null);
    storage.getVerifiedText.mockRejectedValue(new Error("integrity failure"));

    await expect(buildTestJudgeProgram(input)).rejects.toThrow("integrity failure");
    expect(pool.acquire).not.toHaveBeenCalled();
  });
});
