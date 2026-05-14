import { dev } from "$app/environment";
import { fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { getRedis } from "@nojv/redis";

import { getClientIp } from "./client-ip";

// Why: in production we run multiple web instances. A `RateLimiterMemory`
// fallback would make the limit per-instance, which an attacker can bypass
// by spreading requests across replicas. Redis gives a shared counter; if
// Redis is unreachable, we fail closed (deny) rather than degrade silently.
// Local dev keeps the memory fallback so a single laptop without Redis
// still works for development.

// In dev/test, use generous limits to avoid E2E test flakiness
const multiplier = dev ? 10 : 1;

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

function createRateLimiter(points: number, duration: number): RateLimiterLike {
  try {
    const redis = getRedis();
    return new RateLimiterRedis({
      storeClient: redis,
      points: points * multiplier,
      duration,
      keyPrefix: "rl",
    });
  } catch (err) {
    // In dev we tolerate a missing Redis (e.g. running a unit test or a fresh
    // checkout) and fall back to an in-memory limiter. In production we
    // refuse to start a process-local limiter — see the comment above.
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

export const apiRateLimiter = createRateLimiter(60, 60);
export const writeApiRateLimiter = createRateLimiter(10, 60);
const formActionRateLimiter = createRateLimiter(20, 60);

// Password sign-in attempts (`/api/auth/sign-in/email|username`). Strict
// cap targeted at /admin-signin brute force — OAuth flows do not hit this
// limiter. 5 attempts per 15 minutes per IP. Acts as a coarse account
// lockout for the only password-accessible surface (admin / seeded test
// accounts).
export const signInRateLimiter = createRateLimiter(5, 900);

// Internal helper used by `withRateLimit` in `./action-handlers.ts`.
// Not exported on purpose — new routes should compose through the
// wrapper so the limiter can't be bypassed by accident.
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

// Exposed for tests so they can assert fail-closed behaviour without spinning
// up a real Redis. Production code should not import this.
export const __test = { createRateLimiter, RateLimiterFailClosedError };
