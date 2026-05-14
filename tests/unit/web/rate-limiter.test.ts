import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiterMemory } from "rate-limiter-flexible";

describe("rate limiter (RateLimiterMemory smoke test)", () => {
  it("blocks after exceeding points", async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 60 });
    await limiter.consume("test-key");
    await limiter.consume("test-key");
    await expect(limiter.consume("test-key")).rejects.toBeDefined();
  });
});

describe("rate limiter fail-closed in production", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockClientIp(): void {
    // rate-limiter imports getClientIp, which transitively pulls in
    // $env/dynamic/private. Mock it directly so the env shim is bypassed.
    vi.doMock("$lib/server/shared/client-ip", () => ({
      getClientIp: () => "1.2.3.4",
    }));
  }

  it("falls back to memory limiter in dev when Redis is down", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: true, building: false }));
    vi.doMock("@nojv/redis", () => ({
      getRedis: () => {
        throw new Error("Redis not available");
      },
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    // Should not throw — dev fallback uses RateLimiterMemory and counts down points.
    await expect(mod.apiRateLimiter.consume("ip-dev")).resolves.toBeDefined();
  });

  it("fails closed in production when Redis is down", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      getRedis: () => {
        throw new Error("Redis not available");
      },
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    // Every consume should reject — no in-memory fallback in production.
    await expect(mod.apiRateLimiter.consume("ip-prod")).rejects.toBeInstanceOf(
      mod.__test.RateLimiterFailClosedError,
    );
    await expect(mod.writeApiRateLimiter.consume("ip-prod")).rejects.toBeInstanceOf(
      mod.__test.RateLimiterFailClosedError,
    );
  });

  it("consumeFormRateLimitInternal returns 429 fail() when fail-closed in production", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      getRedis: () => {
        throw new Error("Redis not available");
      },
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    // Cast: consumeFormRateLimitInternal now takes RequestEvent but the mocked
    // getClientIp ignores its argument, so a stub is sufficient.
    const fakeEvent = {} as unknown as Parameters<typeof mod.consumeFormRateLimitInternal>[0];
    const result = await mod.consumeFormRateLimitInternal(fakeEvent);
    expect(result).not.toBeNull();
    // SvelteKit's fail() returns an ActionFailure-shaped object with status + data.
    const failObj = result as unknown as { status: number; data: { error: string } };
    expect(failObj.status).toBe(429);
    expect(failObj.data.error).toMatch(/too many requests/i);
  });
});
