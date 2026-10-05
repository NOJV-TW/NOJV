import { describe, expect, it } from "vitest";

import { parseWorkerEnv } from "../../../apps/worker/src/env";

const dockerEnv: Record<string, string> = {
  PORT: "3002",
  REDIS_URL: "redis://localhost:6379",
  SANDBOX_IMAGE: "sandbox:test",
  WORKER_CONCURRENCY: "1",
  EXECUTION_BACKEND: "docker",
  SANDBOX_CPU_LIMIT: "1",
  SANDBOX_MEMORY_MB: "256",
  SANDBOX_PIDS_LIMIT: "64",
};

describe("worker env test-judge settings", () => {
  it("defaults to test judging disabled with two slots", () => {
    expect(parseWorkerEnv(dockerEnv)).toMatchObject({
      WORKER_MODE: "all",
      WASM_OJ_RUNTIME_DIR: "",
      WASM_OJ_TOOLCHAIN_DIR: "",
      WASM_OJ_CACHE_DIR: "/tmp/wasm-oj",
      TEST_JUDGE_SLOTS: 2,
    });
  });

  it("parses a test-mode worker", () => {
    expect(
      parseWorkerEnv({
        ...dockerEnv,
        WORKER_MODE: "test",
        WASM_OJ_RUNTIME_DIR: "/opt/wasm-oj/bin",
        WASM_OJ_TOOLCHAIN_DIR: "/opt/wasm-oj/toolchains",
        TEST_JUDGE_SLOTS: "4",
      }),
    ).toMatchObject({
      WORKER_MODE: "test",
      WASM_OJ_RUNTIME_DIR: "/opt/wasm-oj/bin",
      WASM_OJ_TOOLCHAIN_DIR: "/opt/wasm-oj/toolchains",
      TEST_JUDGE_SLOTS: 4,
    });
  });

  it.each(["0", "9", "1.5"])("rejects TEST_JUDGE_SLOTS=%s", (slots) => {
    expect(() => parseWorkerEnv({ ...dockerEnv, TEST_JUDGE_SLOTS: slots })).toThrow();
  });

  it.each(["1", "8"])("accepts TEST_JUDGE_SLOTS=%s", (slots) => {
    expect(parseWorkerEnv({ ...dockerEnv, TEST_JUDGE_SLOTS: slots }).TEST_JUDGE_SLOTS).toBe(
      Number(slots),
    );
  });
});
