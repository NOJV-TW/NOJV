import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WASM_OJ_SERVER_VERSIONS } from "@nojv/core";

import {
  loadServerToolchains,
  poolEngines,
  warmEngine,
  type TestJudgeEngine,
} from "../../../apps/worker/src/test-judge/runtime";

vi.mock("../../../apps/worker/src/logger.js", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type BuildResult = Awaited<ReturnType<TestJudgeEngine["compile"]>>;
type RunResult = Awaited<ReturnType<TestJudgeEngine["run"]>>;

function fakeEngines(count: number) {
  return Array.from({ length: count }, (_, id) => ({ id, dispose: vi.fn() }));
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setImmediate(resolve));
  return done;
}

describe("test-judge engine pool", () => {
  it("hands each idle engine to one holder at a time", async () => {
    const pool = poolEngines(fakeEngines(2));

    const first = await pool.acquire();
    const second = await pool.acquire();
    const third = pool.acquire();

    expect(first.engine.id).not.toBe(second.engine.id);
    expect(await settled(third)).toBe(false);

    second.release();
    expect((await third).engine.id).toBe(second.engine.id);
  });

  it("serves waiters in arrival order", async () => {
    const pool = poolEngines(fakeEngines(1));
    const holder = await pool.acquire();
    const order: string[] = [];

    const a = pool.acquire().then((lease) => {
      order.push("a");
      return lease;
    });
    const b = pool.acquire().then((lease) => {
      order.push("b");
      return lease;
    });

    holder.release();
    (await a).release();
    (await b).release();

    expect(order).toEqual(["a", "b"]);
  });

  it("ignores a second release of the same lease", async () => {
    const pool = poolEngines(fakeEngines(1));
    const holder = await pool.acquire();
    const a = pool.acquire();
    const b = pool.acquire();

    holder.release();
    holder.release();

    await a;
    expect(await settled(b)).toBe(false);
  });

  it("disposes every engine, including leased ones, and rejects waiters", async () => {
    const engines = fakeEngines(2);
    const pool = poolEngines(engines);
    await pool.acquire();
    await pool.acquire();
    const waiter = pool.acquire();

    pool.dispose();

    for (const engine of engines) expect(engine.dispose).toHaveBeenCalledOnce();
    await expect(waiter).rejects.toThrow("disposed");
    await expect(pool.acquire()).rejects.toThrow("disposed");
  });
});

describe("test-judge toolchain loading", () => {
  it("refuses a toolchain whose version differs from the pinned identity", async () => {
    const toolchainDir = await mkdtemp(path.join(os.tmpdir(), "nojv-toolchains-"));
    try {
      const packageDir = path.join(toolchainDir, "node_modules/@wasm-oj/toolchain-clang");
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ version: "9.9.9" }),
      );

      await expect(loadServerToolchains(toolchainDir)).rejects.toThrow(
        `@wasm-oj/toolchain-clang in ${toolchainDir} is 9.9.9; the worker needs ${WASM_OJ_SERVER_VERSIONS.clang}.`,
      );
    } finally {
      await rm(toolchainDir, { recursive: true, force: true });
    }
  });
});

describe("test-judge engine warm-up", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function warmableEngine() {
    const engine = {
      compile: vi.fn(
        async (input: Parameters<TestJudgeEngine["compile"]>[0]) =>
          ({
            success: true,
            artifact: { language: input.language },
            stderr: "",
          }) as unknown as BuildResult,
      ),
      run: vi.fn(async () => ({ code: 42, termination: "exited" }) as unknown as RunResult),
      cancel: vi.fn(),
    };
    const stall = () =>
      new Promise<never>((_resolve, reject) => {
        engine.cancel.mockImplementationOnce(() => reject(new Error("cancelled")));
      });
    return { engine, stall };
  }

  it("builds and runs a Python and a C++ judge program once", async () => {
    const { engine } = warmableEngine();

    await warmEngine(engine);

    expect(engine.compile.mock.calls.map(([input]) => input.language)).toEqual([
      "python",
      "cpp",
    ]);
    expect(engine.compile.mock.calls[0]?.[0].files["main.py"]).toMatch(/accept\(\)\n$/);
    expect(engine.run).toHaveBeenCalledTimes(2);
    expect(engine.cancel).not.toHaveBeenCalled();
  });

  it("cancels a warm-up that stalls for 20 s and retries it", async () => {
    vi.useFakeTimers();
    const { engine, stall } = warmableEngine();
    engine.run.mockImplementationOnce(stall);

    const warming = warmEngine(engine);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(engine.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(warming).resolves.toBeUndefined();
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.run).toHaveBeenCalledTimes(3);
  });

  it("retries a warm-up program that does not exit with 42", async () => {
    const { engine } = warmableEngine();
    engine.run.mockResolvedValueOnce({
      code: 1,
      termination: "exited",
    } as unknown as RunResult);

    await warmEngine(engine);

    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.run).toHaveBeenCalledTimes(3);
  });

  it("fails after three stalled attempts", async () => {
    vi.useFakeTimers();
    const { engine, stall } = warmableEngine();
    engine.compile.mockImplementation(stall);

    const warming = warmEngine(engine);
    const failure = expect(warming).rejects.toThrow(
      "A test-judge engine failed its warm-up 3 times: Warm-up exceeded 20000 ms.",
    );
    await vi.advanceTimersByTimeAsync(60_000);

    await failure;
    expect(engine.compile).toHaveBeenCalledTimes(3);
    expect(engine.cancel).toHaveBeenCalledTimes(3);
  });
});
