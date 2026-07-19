import { dev } from "$app/environment";
import { fail } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { createRateLimiterConnection } from "@nojv/redis";

import { getClientIp } from "./client-ip";

const multiplier = dev ? 1000 : 1;

export type RateLimitResult = "allowed" | "limited" | "unavailable";

export interface RateLimiterLike {
  readonly keyPrefix: string;
  readonly points: number;
  readonly duration: number;
  consume: (key: string) => Promise<RateLimitResult>;
}

const OPERATIONAL_REDIS_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

const OPERATIONAL_REDIS_ERROR_NAMES = new Set([
  "AbortError",
  "ClusterAllFailedError",
  "MaxRetriesPerRequestError",
]);

const TRANSIENT_REDIS_REPLY_PREFIXES = [
  "CLUSTERDOWN ",
  "LOADING ",
  "MASTERDOWN ",
  "READONLY ",
  "TRYAGAIN ",
];

function isOperationalRedisError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  ) {
    return false;
  }

  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && OPERATIONAL_REDIS_ERROR_CODES.has(code)) return true;
  if (OPERATIONAL_REDIS_ERROR_NAMES.has(error.name)) return true;
  if (
    error.name === "ReplyError" &&
    TRANSIENT_REDIS_REPLY_PREFIXES.some((prefix) => error.message.startsWith(prefix))
  ) {
    return true;
  }
  return (
    error.message === "Connection is closed." ||
    error.message === "Redis connection is not ready" ||
    error.message === "Command timed out" ||
    error.message.startsWith(
      "Stream isn't writeable and enableOfflineQueue options is false",
    ) ||
    error.message.startsWith("Reached the max retries per request limit")
  );
}

async function consumeKnownLimiter(
  limiter: { consume(key: string): Promise<unknown> },
  key: string,
): Promise<"allowed" | "limited"> {
  try {
    await limiter.consume(key);
    return "allowed";
  } catch (error) {
    if (error instanceof RateLimiterRes) return "limited";
    throw error;
  }
}

function createRateLimiter(
  keyPrefix: string,
  points: number,
  duration: number,
  failMode: "local" | "strict" = "strict",
): RateLimiterLike {
  if (dev) {
    const memoryLimiter = new RateLimiterMemory({
      points: points * multiplier,
      duration,
    });
    return {
      keyPrefix,
      points,
      duration,
      consume: (key) => consumeKnownLimiter(memoryLimiter, key),
    };
  }
  const redis = createRateLimiterConnection();
  const redisLimiter = new RateLimiterRedis({
    storeClient: redis,
    points: points * multiplier,
    duration,
    keyPrefix,
  });
  const memoryFallback =
    failMode === "local"
      ? new RateLimiterMemory({ points: points * multiplier, duration })
      : null;
  return {
    keyPrefix,
    points,
    duration,
    async consume(key: string) {
      try {
        return await consumeKnownLimiter(redisLimiter, key);
      } catch (error) {
        if (!isOperationalRedisError(error)) throw error;
        if (memoryFallback) return consumeKnownLimiter(memoryFallback, key);
        return "unavailable";
      }
    },
  };
}

export const apiRateLimiter = createRateLimiter("rl:api", 60, 60, "local");
export const writeApiRateLimiter = createRateLimiter("rl:write", 10, 60);
const formActionRateLimiter = createRateLimiter("rl:form", 20, 60);
export const authRateLimiter = createRateLimiter("rl:auth", 60, 60);

export const signInRateLimiter = createRateLimiter("rl:signin", 5, 900);

export const otpSendRateLimiter = createRateLimiter("rl:2fa-otp", 3, 600);
export const stepUpAttemptRateLimiter = createRateLimiter("rl:stepup", 5, 600);
export const registryTokenRateLimiter = createRateLimiter("rl:registry-token", 60, 60);
export const remoteAssetFetchRateLimiter = createRateLimiter("rl:remote-fetch", 10, 60);

export async function consumeFormRateLimitInternal(
  event: RequestEvent,
): Promise<ReturnType<typeof fail<{ error: string }>> | null> {
  const result = await formActionRateLimiter.consume(getClientIp(event));
  if (result === "allowed") return null;
  if (result === "limited") {
    return fail(429, { error: "Too many requests. Please try again later." });
  }
  return fail(503, { error: "Rate limiter unavailable. Please try again later." });
}

export const __test = { createRateLimiter, isOperationalRedisError };
