import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createEnginePool,
  type EnginePool,
  type TestJudgeEngine,
} from "../../../apps/worker/src/test-judge/runtime";

const runtimeDir = process.env.WASM_OJ_RUNTIME_DIR ?? "";
const toolchainDir = process.env.WASM_OJ_TOOLCHAIN_DIR ?? "";

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
});
