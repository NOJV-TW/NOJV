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

function mockClientIp(): void {
  vi.doMock("$lib/server/shared/client-ip", () => ({
    getClientIp: () => "1.2.3.4",
  }));
}

function makeDisconnectedRedis(): object {
  return {
    on() {},
    call() {
      return Promise.reject(new Error("Connection is closed."));
    },
    sendCommand() {
      return Promise.reject(new Error("Connection is closed."));
    },
  };
}

describe("rate limiter fail-closed in production", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses memory limiter in dev mode", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: true, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () => ({}),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    await expect(mod.apiRateLimiter.consume("ip-dev")).resolves.toBeDefined();
  });

  it("fails closed in production when Redis rejects consume", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: makeDisconnectedRedis,
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    await expect(mod.apiRateLimiter.consume("ip-prod")).rejects.toBeInstanceOf(
      mod.__test.RateLimiterFailClosedError,
    );
    await expect(mod.writeApiRateLimiter.consume("ip-prod")).rejects.toBeInstanceOf(
      mod.__test.RateLimiterFailClosedError,
    );
  });

  it("consumeFormRateLimitInternal returns 429 fail() when Redis is down in production", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: makeDisconnectedRedis,
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const fakeEvent = {} as unknown as Parameters<typeof mod.consumeFormRateLimitInternal>[0];
    const result = await mod.consumeFormRateLimitInternal(fakeEvent);
    expect(result).not.toBeNull();
    const failObj = result as unknown as { status: number; data: { error: string } };
    expect(failObj.status).toBe(429);
    expect(failObj.data.error).toMatch(/too many requests/i);
  });
});

describe("rate limiter key prefixes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("gives each limiter its own Redis keyPrefix so per-IP counters never collide", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({ createRateLimiterConnection: () => ({}) }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const prefixes = [mod.apiRateLimiter, mod.writeApiRateLimiter, mod.signInRateLimiter].map(
      (limiter) => (limiter as { keyPrefix?: string }).keyPrefix,
    );
    expect(prefixes).toEqual(["rl:api", "rl:write", "rl:signin"]);
  });
});
