import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MockActivityEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  serialiseBuildArtifact,
  type JudgeProgramSource,
  type TestJudgeStoredRequest,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";

import {
  runTestJudge,
  setTestJudgeDeps,
  type TestJudgeStorage,
} from "../../../apps/worker/src/activities/test-judge";
import {
  getJudgeProgram,
  type JudgeProgram,
  type JudgeProgramStore,
} from "../../../apps/worker/src/test-judge/judge-program";
import {
  createEnginePool,
  type EnginePool,
  type TestJudgeEngine,
} from "../../../apps/worker/src/test-judge/runtime";

type BuildArtifact = Extract<JudgeProgram, { ok: true }>["artifact"];

const runtimeDir = process.env.WASM_OJ_RUNTIME_DIR ?? "";
const toolchainDir = process.env.WASM_OJ_TOOLCHAIN_DIR ?? "";

const CPP_SUM_CHECKER = `#include <bits/stdc++.h>
int main(int argc, char **argv) {
  std::ifstream input(argv[1]);
  std::ifstream answer(argv[2]);
  long long a, b, expected, got;
  input >> a >> b;
  answer >> expected;
  std::ofstream team(std::string(argv[3]) + "/teammessage.txt");
  if (!(std::cin >> got) || got != a + b || got != expected) {
    team << "expected " << expected;
    return 43;
  }
  team << "sum ok";
  return 42;
}
`;

const PYTHON_SUM_CHECKER = `a, b = map(int, judge_input.split())
expected = int(judge_answer)
got = team_output.split()
if len(got) == 1 and int(got[0]) == a + b == expected:
    accept("sum ok")
wrong(f"expected {expected}")
`;

const CPP_GUESS_INTERACTOR = `#include <bits/stdc++.h>
int main(int argc, char **argv) {
  std::ifstream input(argv[1]);
  long long secret;
  input >> secret;
  for (int turn = 0; turn < 30; ++turn) {
    long long guess;
    if (!(std::cin >> guess)) return 43;
    if (guess == secret) {
      std::cout << "correct" << std::endl;
      return 42;
    }
    std::cout << (guess < secret ? "higher" : "lower") << std::endl;
  }
  return 43;
}
`;

const CPP_GUESS_CONTESTANT = `#include <cstdio>
#include <cstring>
int main() {
  long long lo = 1, hi = 1000000;
  char reply[16];
  while (lo <= hi) {
    long long mid = (lo + hi) / 2;
    std::printf("%lld\\n", mid);
    std::fflush(stdout);
    if (std::scanf("%15s", reply) != 1 || std::strcmp(reply, "correct") == 0) return 0;
    if (std::strcmp(reply, "higher") == 0) lo = mid + 1;
    else hi = mid - 1;
  }
}
`;

const CPP_SPIN_CONTESTANT = `int main() {
  volatile unsigned long long spins = 0;
  for (;;) spins = spins + 1;
}
`;

const REQUEST_KEY = "test-judge-requests/integration.json";
const SCRIPT_POINTER = { key: "problems/p1/judge.cpp", sha256: "a".repeat(64), size: 1 };

function memoryStore(): JudgeProgramStore {
  const objects = new Map<string, string>();
  return {
    get: async (key) => objects.get(key) ?? null,
    put: async (key, body) => {
      objects.set(key, body);
    },
  };
}

async function runChecker(engine: TestJudgeEngine, checker: BuildArtifact, output: string) {
  const result = await engine.run(checker, {
    args: ["/judge/input", "/judge/answer", "/judge/feedback"],
    stdin: output,
    files: {
      "/judge/input": "2 3\n",
      "/judge/answer": "5\n",
      "/judge/feedback/.keep": "",
    },
    outputPaths: ["/judge/feedback/teammessage.txt"],
  });
  const teamMessage = result.files["/judge/feedback/teammessage.txt"];
  return {
    code: result.code,
    termination: result.termination,
    teamMessage: teamMessage && new TextDecoder().decode(teamMessage),
  };
}

function useRequest(
  pool: EnginePool<TestJudgeEngine>,
  request: TestJudgeStoredRequest,
  script: string,
) {
  const blobs = new Map([[REQUEST_KEY, JSON.stringify(request)]]);
  const storage: TestJudgeStorage = {
    getText: async (key) => {
      const body = blobs.get(key);
      if (body === undefined) throw new Error(`missing ${key}`);
      return body;
    },
    getVerifiedText: async () => script,
    deleteBlob: async (key) => {
      blobs.delete(key);
    },
  };
  setTestJudgeDeps({ pool, storage, programs: memoryStore() });
  return blobs;
}

function judgeRequest(): Promise<TestJudgeWorkflowOutput> {
  return new MockActivityEnvironment({ scheduledTimestampMs: Date.now() }).run(runTestJudge, {
    requestKey: REQUEST_KEY,
  });
}

async function compileContestant(pool: EnginePool<TestJudgeEngine>, source: string) {
  const { engine, release } = await pool.acquire();
  try {
    const build = await engine.compile({
      language: "cpp",
      entry: "main.cpp",
      files: { "main.cpp": source },
    });
    expect(build.success, build.stderr).toBe(true);
    return build.artifact!;
  } finally {
    release();
  }
}

function interactiveRequest(
  contestant: BuildArtifact,
  secrets: string[],
): TestJudgeStoredRequest {
  return {
    kind: "interactive",
    judgeLanguage: "cpp",
    judgeScriptPointer: SCRIPT_POINTER,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    runtimeEnv: {},
    contestantLanguage: "cpp",
    artifact: serialiseBuildArtifact(contestant),
    cases: secrets.map((secret) => ({ interactorInput: `${secret}\n` })),
  };
}

describe.skipIf(!runtimeDir || !toolchainDir)("test-judge WASM-OJ runtime", () => {
  let cacheDir: string;
  let pool: EnginePool<TestJudgeEngine>;

  beforeAll(async () => {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "nojv-wasm-oj-"));
    pool = await createEnginePool({ runtimeDir, toolchainDir, cacheDir, slots: 2 });
  }, 300_000);

  afterAll(async () => {
    pool?.dispose();
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
  });

  it("warms the Python runtime of every engine before handing the pool out", async () => {
    for (const slot of ["0", "1"]) {
      expect(await readdir(path.join(cacheDir, slot, "runtime"))).toEqual([
        expect.stringMatching(/\.wasmojfs$/),
      ]);
    }
  });

  it("compiles and runs C++ on a pooled engine", async () => {
    const { engine, release } = await pool.acquire();
    try {
      const build = await engine.compile({
        language: "cpp",
        entry: "main.cpp",
        files: { "main.cpp": '#include <cstdio>\nint main() { std::printf("42\\n"); }\n' },
      });
      expect(build.success, build.stderr).toBe(true);
      const result = await engine.run(build.artifact!);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("42\n");
    } finally {
      release();
    }
  }, 300_000);

  it.each([
    ["C++", { role: "checker", language: "cpp", source: CPP_SUM_CHECKER }],
    ["Python", { role: "checker", language: "python", source: PYTHON_SUM_CHECKER }],
  ] satisfies [string, JudgeProgramSource][])(
    "builds, caches and runs a %s DOMjudge checker",
    async (_label, input) => {
      const { engine, release } = await pool.acquire();
      try {
        const compiler = { compile: vi.fn(engine.compile.bind(engine)) };
        const store = memoryStore();

        const built = await getJudgeProgram({ engine: compiler, store }, input);
        expect(built.ok, built.ok ? "" : built.diagnostics).toBe(true);
        if (!built.ok) return;

        expect(await runChecker(engine, built.artifact, "5\n")).toEqual({
          code: 42,
          termination: "exited",
          teamMessage: "sum ok",
        });
        expect(await runChecker(engine, built.artifact, "6\n")).toEqual({
          code: 43,
          termination: "exited",
          teamMessage: "expected 5",
        });

        const cached = await getJudgeProgram({ engine: compiler, store }, input);
        expect(compiler.compile).toHaveBeenCalledTimes(1);
        expect(cached.ok).toBe(true);
        if (!cached.ok) return;
        expect(await runChecker(engine, cached.artifact, "5\n")).toMatchObject({ code: 42 });
        expect(await runChecker(engine, cached.artifact, "6\n")).toMatchObject({ code: 43 });
      } finally {
        release();
      }
    },
    300_000,
  );

  it("survives cancelling a run while its request is still being written", async () => {
    const { engine, release } = await pool.acquire();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const built = await getJudgeProgram(
        { engine, store: memoryStore() },
        { role: "checker", language: "python", source: PYTHON_SUM_CHECKER },
      );
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(await runChecker(engine, built.artifact, "5\n")).toMatchObject({ code: 42 });

      for (const delayMs of [0, 1, 5, 20]) {
        const run = runChecker(engine, built.artifact, "5\n");
        setTimeout(() => engine.cancel(), delayMs);
        await run.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      release();
    }
  }, 300_000);

  it("builds a C++ checker that does not include bits/stdc++.h without the libc++ PCH", async () => {
    const { engine, release } = await pool.acquire();
    try {
      const built = await getJudgeProgram(
        { engine, store: memoryStore() },
        {
          role: "checker",
          language: "cpp",
          source:
            '#include <cstdio>\nusing namespace std;\nint count = 0;\nint main(){count=1;std::printf("%d",count);return 42;}\n',
        },
      );
      expect(built.ok, built.ok ? "" : built.diagnostics).toBe(true);
      if (!built.ok) return;

      const result = await engine.run(built.artifact);
      expect(result.code).toBe(42);
      expect(result.stdout).toBe("1");
    } finally {
      release();
    }
  }, 300_000);

  it("caches the diagnostics of a checker that does not compile", async () => {
    const { engine, release } = await pool.acquire();
    try {
      const compiler = { compile: vi.fn(engine.compile.bind(engine)) };
      const store = memoryStore();
      const input = { role: "checker", language: "cpp", source: "int main( {" } as const;

      const first = await getJudgeProgram({ engine: compiler, store }, input);
      const second = await getJudgeProgram({ engine: compiler, store }, input);

      expect(first.ok).toBe(false);
      expect(second).toEqual(first);
      expect(compiler.compile).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  }, 300_000);

  it("judges a checker request end to end", async () => {
    const blobs = useRequest(
      pool,
      {
        kind: "checker",
        judgeLanguage: "cpp",
        judgeScriptPointer: SCRIPT_POINTER,
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        runtimeEnv: {},
        cases: [
          { input: "2 3\n", expectedOutput: "5\n", output: "5\n" },
          { input: "2 3\n", expectedOutput: "5\n", output: "6\n" },
        ],
      },
      CPP_SUM_CHECKER,
    );

    await expect(judgeRequest()).resolves.toEqual({
      ok: true,
      cases: [
        { verdict: "AC", teamMessage: "sum ok" },
        { verdict: "WA", teamMessage: "expected 5" },
      ],
    });
    expect(blobs.size).toBe(0);
  }, 300_000);

  it("judges an interactive request end to end with a C++ interactor", async () => {
    const contestant = await compileContestant(pool, CPP_GUESS_CONTESTANT);
    const blobs = useRequest(
      pool,
      interactiveRequest(contestant, ["37", "999999"]),
      CPP_GUESS_INTERACTOR,
    );

    const output = await judgeRequest();

    expect(output.ok).toBe(true);
    if (!output.ok) return;
    expect(output.cases.map(({ verdict }) => verdict)).toEqual(["AC", "AC"]);
    for (const result of output.cases) {
      expect(result.transcript?.toInteractor).toMatch(/^500000\n/);
      expect(result.transcript?.toContestant).toMatch(/correct\n$/);
    }
    expect(blobs.size).toBe(0);
  }, 300_000);

  it("reports TLE for a spinning interactive contestant within its wall stop", async () => {
    const contestant = await compileContestant(pool, CPP_SPIN_CONTESTANT);
    useRequest(pool, interactiveRequest(contestant, ["37"]), CPP_GUESS_INTERACTOR);

    const started = Date.now();
    const output = await judgeRequest();
    const elapsedMs = Date.now() - started;

    expect(output).toMatchObject({ ok: true, cases: [{ verdict: "TLE" }] });
    expect(elapsedMs).toBeGreaterThanOrEqual(3_000);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 300_000);
});
