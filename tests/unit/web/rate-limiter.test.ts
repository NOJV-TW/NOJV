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

function makeRedisClient(consume: () => Promise<unknown>): object {
  const client = {
    on() {},
    multi: () => ({}),
    defineCommand(name: string) {
      Object.assign(client, { [name]: consume });
    },
  };
  return client;
}

function makeDisconnectedRedis(): object {
  return makeRedisClient(() => Promise.reject(new Error("Connection is closed.")));
}

describe("rate limiter fail modes in production", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("$app/environment");
    vi.doUnmock("@nojv/redis");
    vi.doUnmock("$lib/server/shared/client-ip");
  });

  it("uses memory limiter in dev mode", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: true, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () => ({}),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    await expect(mod.apiRateLimiter.consume("ip-dev")).resolves.toBe("allowed");
  });

  it("strict limiters report unavailable when Redis is down in production", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: makeDisconnectedRedis,
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    await expect(mod.writeApiRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
    await expect(mod.authRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
    await expect(mod.signInRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
    await expect(mod.otpSendRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
    await expect(mod.stepUpAttemptRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
    await expect(mod.registryTokenRateLimiter.consume("ip-prod")).resolves.toBe("unavailable");
  });

  it("read limiting retries Redis before every bounded local consume", async () => {
    const redisConsumes = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection is closed."))
      .mockResolvedValueOnce([1, 60_000])
      .mockRejectedValueOnce(new Error("Connection is closed."));
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () => makeRedisClient(redisConsumes),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const limiter = mod.__test.createRateLimiter("rl:test-read", 1, 60, "local");
    await expect(limiter.consume("ip-prod")).resolves.toBe("allowed");
    await expect(limiter.consume("ip-prod")).resolves.toBe("allowed");
    await expect(limiter.consume("ip-prod")).resolves.toBe("limited");
    expect(redisConsumes).toHaveBeenCalledTimes(3);
  });

  it.each(["strict", "local"] as const)(
    "propagates programming errors instead of treating them as %s Redis outages",
    async (failMode) => {
      const programmingError = new TypeError("invalid Redis adapter contract");
      vi.doMock("$app/environment", () => ({
        browser: false,
        dev: false,
        building: false,
      }));
      vi.doMock("@nojv/redis", () => ({
        createRateLimiterConnection: () =>
          makeRedisClient(() => Promise.reject(programmingError)),
      }));
      mockClientIp();

      const mod = await import("$lib/server/shared/rate-limiter");
      const limiter = mod.__test.createRateLimiter("rl:test-error", 1, 60, failMode);
      await expect(limiter.consume("ip-prod")).rejects.toBe(programmingError);
    },
  );

  it("form limiting returns 503 when Redis is down in production", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: makeDisconnectedRedis,
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const fakeEvent = {} as unknown as Parameters<typeof mod.consumeFormRateLimitInternal>[0];
    const result = await mod.consumeFormRateLimitInternal(fakeEvent);
    expect(result).toMatchObject({ status: 503 });
  });

  it("maps actual form-limiter quota exhaustion to 429", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () => makeRedisClient(() => Promise.resolve([21, 60_000])),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const fakeEvent = {} as unknown as Parameters<typeof mod.consumeFormRateLimitInternal>[0];
    const result = await mod.consumeFormRateLimitInternal(fakeEvent);
    expect(result).toMatchObject({ status: 429 });
  });

  it("propagates non-transient Redis reply errors from the factory", async () => {
    const programmingReplyError = Object.assign(
      new Error("ERR Error running script: attempt to call a nil value"),
      { name: "ReplyError" },
    );
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () =>
        makeRedisClient(() => Promise.reject(programmingReplyError)),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const limiter = mod.__test.createRateLimiter("rl:test-reply-error", 1, 60);
    await expect(limiter.consume("ip-prod")).rejects.toBe(programmingReplyError);
  });

  it("treats a transient Redis reply as strict limiter unavailability", async () => {
    const loadingReply = Object.assign(new Error("LOADING Redis is loading the dataset"), {
      name: "ReplyError",
    });
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({
      createRateLimiterConnection: () => makeRedisClient(() => Promise.reject(loadingReply)),
    }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const limiter = mod.__test.createRateLimiter("rl:test-reply-outage", 1, 60);
    await expect(limiter.consume("ip-prod")).resolves.toBe("unavailable");
  });
});

describe("rate limiter key prefixes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("$app/environment");
    vi.doUnmock("@nojv/redis");
    vi.doUnmock("$lib/server/shared/client-ip");
  });

  it("gives each limiter its own Redis keyPrefix so per-IP counters never collide", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({ createRateLimiterConnection: () => ({}) }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    const prefixes = [
      mod.apiRateLimiter,
      mod.writeApiRateLimiter,
      mod.authRateLimiter,
      mod.signInRateLimiter,
      mod.registryTokenRateLimiter,
    ].map((limiter) => (limiter as { keyPrefix?: string }).keyPrefix);
    expect(prefixes).toEqual([
      "rl:api",
      "rl:write",
      "rl:auth",
      "rl:signin",
      "rl:registry-token",
    ]);
  });

  it("keeps every exported quota exact, including registry tokens at 60 per minute", async () => {
    vi.doMock("$app/environment", () => ({ browser: false, dev: false, building: false }));
    vi.doMock("@nojv/redis", () => ({ createRateLimiterConnection: () => ({}) }));
    mockClientIp();

    const mod = await import("$lib/server/shared/rate-limiter");
    expect([
      mod.apiRateLimiter,
      mod.writeApiRateLimiter,
      mod.authRateLimiter,
      mod.signInRateLimiter,
      mod.otpSendRateLimiter,
      mod.stepUpAttemptRateLimiter,
      mod.registryTokenRateLimiter,
    ]).toMatchObject([
      { keyPrefix: "rl:api", points: 60, duration: 60 },
      { keyPrefix: "rl:write", points: 10, duration: 60 },
      { keyPrefix: "rl:auth", points: 60, duration: 60 },
      { keyPrefix: "rl:signin", points: 5, duration: 900 },
      { keyPrefix: "rl:2fa-otp", points: 3, duration: 600 },
      { keyPrefix: "rl:stepup", points: 5, duration: 600 },
      { keyPrefix: "rl:registry-token", points: 60, duration: 60 },
    ]);
  });
});
