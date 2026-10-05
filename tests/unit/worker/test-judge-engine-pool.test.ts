import { describe, expect, it, vi } from "vitest";

import { poolEngines } from "../../../apps/worker/src/test-judge/runtime";

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
