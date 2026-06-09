import { dev } from "$app/environment";
import { fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis } from "@nojv/redis";

import { getClientIp } from "./client-ip";

const multiplier = dev ? 1000 : 1;

interface RateLimiterLike {
  consume: (key: string) => Promise<unknown>;
}

class RateLimiterFailClosedError extends Error {
  readonly msBeforeNext = 60_000;
  readonly remainingPoints = 0;
  constructor() {
    super("Rate limiter unavailable — failing closed");
    this.name = "RateLimiterFailClosedError";
  }
}

const failClosedLimiter: RateLimiterLike = {
  consume() {
    return Promise.reject(new RateLimiterFailClosedError());
  },
};

function createRateLimiter(
  keyPrefix: string,
  points: number,
  duration: number,
): RateLimiterLike {
  try {
    const redis = getRedis();
    return new RateLimiterRedis({
      storeClient: redis,
      points: points * multiplier,
      duration,
      keyPrefix,
    });
  } catch (err) {
    if (dev) {
      return new RateLimiterMemory({
        points: points * multiplier,
        duration,
      });
    }
    console.error(
      "[rate-limiter] Redis unavailable in production — failing closed for all requests until Redis recovers.",
      err,
    );
    return failClosedLimiter;
  }
}

export const apiRateLimiter = createRateLimiter("rl:api", 60, 60);
export const writeApiRateLimiter = createRateLimiter("rl:write", 10, 60);
const formActionRateLimiter = createRateLimiter("rl:form", 20, 60);

export const signInRateLimiter = createRateLimiter("rl:signin", 5, 900);

export async function consumeFormRateLimitInternal(
  event: RequestEvent,
): Promise<ReturnType<typeof fail<{ error: string }>> | null> {
  try {
    await formActionRateLimiter.consume(getClientIp(event));
    return null;
  } catch (err) {
    if (err instanceof RateLimiterRes || err instanceof RateLimiterFailClosedError) {
      return fail(429, { error: "Too many requests. Please try again later." });
    }
    throw err;
  }
}

export const __test = { createRateLimiter, RateLimiterFailClosedError };
