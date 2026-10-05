import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  getJudgeProgram,
  type BuildArtifact,
  type JudgeProgramInput,
  type JudgeProgramStore,
} from "../../../apps/worker/src/test-judge/judge-program";
import {
  createEnginePool,
  type EnginePool,
  type TestJudgeEngine,
} from "../../../apps/worker/src/test-judge/runtime";

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

describe.skipIf(!runtimeDir || !toolchainDir)("test-judge WASM-OJ runtime", () => {
  let cacheDir: string;
  let pool: EnginePool<TestJudgeEngine>;

  beforeAll(async () => {
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "nojv-wasm-oj-"));
    pool = await createEnginePool({ runtimeDir, toolchainDir, cacheDir, slots: 1 });
  }, 300_000);

  afterAll(async () => {
    pool?.dispose();
    if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
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
  ] satisfies [string, JudgeProgramInput][])(
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
});
