import { describe, expect, it, vi } from "vitest";

import { createTtlCache } from "$lib/server/exam-context-cache";

describe("createTtlCache", () => {
  it("memoizes within the TTL and reloads after expiry", async () => {
    const cache = createTtlCache<number>(1000, 100);
    const load = vi.fn(async () => 42);

    expect(await cache.getOrLoad("k", load)).toBe(42);
    expect(await cache.getOrLoad("k", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("invalidate forces the next lookup to reload — closes the post-start gate gap", async () => {
    const cache = createTtlCache<string>(60_000, 100);
    let value = "before";
    const load = vi.fn(async () => value);

    expect(await cache.getOrLoad("user-1", load)).toBe("before");
    expect(load).toHaveBeenCalledTimes(1);

    // Simulate the state changing (session started) without waiting for TTL.
    value = "after";
    cache.invalidate("user-1");

    expect(await cache.getOrLoad("user-1", load)).toBe("after");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidate of one key does not evict others", async () => {
    const cache = createTtlCache<number>(60_000, 100);
    await cache.getOrLoad("a", async () => 1);
    await cache.getOrLoad("b", async () => 2);

    cache.invalidate("a");

    const reloadA = vi.fn(async () => 10);
    const reloadB = vi.fn(async () => 20);
    expect(await cache.getOrLoad("a", reloadA)).toBe(10); // reloaded
    expect(await cache.getOrLoad("b", reloadB)).toBe(2); // still cached
    expect(reloadB).not.toHaveBeenCalled();
  });
});
