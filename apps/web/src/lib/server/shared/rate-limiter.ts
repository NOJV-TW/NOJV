import { dev } from "$app/environment";
import { fail } from "@sveltejs/kit";
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis } from "@nojv/redis";

// In dev/test, use generous limits to avoid E2E test flakiness
const multiplier = dev ? 10 : 1;

function createRateLimiter(points: number, duration: number) {
  try {
    const redis = getRedis();
    return new RateLimiterRedis({
      storeClient: redis,
      points: points * multiplier,
      duration,
      keyPrefix: "rl",
    });
  } catch {
    // Fallback to memory if Redis is not available (e.g., during build)
    return new RateLimiterMemory({
      points: points * multiplier,
      duration,
    });
  }
}

export const apiRateLimiter = createRateLimiter(60, 60);
export const writeApiRateLimiter = createRateLimiter(10, 60);
const formActionRateLimiter = createRateLimiter(20, 60);

export async function consumeFormRateLimit(event: {
  getClientAddress: () => string;
}): Promise<ReturnType<typeof fail<{ error: string }>> | null> {
  try {
    await formActionRateLimiter.consume(event.getClientAddress());
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    throw err;
  }
}
