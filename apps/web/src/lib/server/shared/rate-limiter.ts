import { dev } from "$app/environment";
import { fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { createRateLimiterConnection } from "@nojv/redis";

import { getClientIp } from "./client-ip";

const multiplier = dev ? 1000 : 1;

interface RateLimiterLike {
  keyPrefix?: string;
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

function createRateLimiter(
  keyPrefix: string,
  points: number,
  duration: number,
): RateLimiterLike {
  if (dev) {
    return new RateLimiterMemory({
      points: points * multiplier,
      duration,
    });
  }
  const redis = createRateLimiterConnection();
  const redisLimiter = new RateLimiterRedis({
    storeClient: redis,
    points: points * multiplier,
    duration,
    keyPrefix,
  });
  return {
    keyPrefix,
    consume(key: string) {
      return redisLimiter.consume(key).catch((err: unknown) => {
        if (err instanceof RateLimiterRes) throw err;
        throw new RateLimiterFailClosedError();
      });
    },
  };
}

export const apiRateLimiter = createRateLimiter("rl:api", 60, 60);
export const writeApiRateLimiter = createRateLimiter("rl:write", 10, 60);
const formActionRateLimiter = createRateLimiter("rl:form", 20, 60);

export const signInRateLimiter = createRateLimiter("rl:signin", 5, 900);

export const otpSendRateLimiter = createRateLimiter("rl:2fa-otp", 3, 600);
export const stepUpAttemptRateLimiter = createRateLimiter("rl:stepup", 5, 600);

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
