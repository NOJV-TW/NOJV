import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { WASM_OJ_SERVER_VERSIONS } from "@nojv/core";

import { loadServerToolchains, poolEngines } from "../../../apps/worker/src/test-judge/runtime";

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
