import { describe, it, expect } from "vitest";
import { RateLimiterMemory } from "rate-limiter-flexible";

describe("rate limiter", () => {
  it("blocks after exceeding points", async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 60 });
    await limiter.consume("test-key");
    await limiter.consume("test-key");
    await expect(limiter.consume("test-key")).rejects.toBeDefined();
  });
});
