import type { RequestEvent } from "@sveltejs/kit";
import { consumeFormRateLimitInternal } from "./rate-limiter";

type RateLimitFailure = NonNullable<Awaited<ReturnType<typeof consumeFormRateLimitInternal>>>;

export function withRateLimit<E extends RequestEvent, R>(
  handler: (event: E) => Promise<R>,
): (event: E) => Promise<R | RateLimitFailure> {
  return async (event) => {
    const limited = await consumeFormRateLimitInternal(event);
    if (limited) return limited;
    return handler(event);
  };
}
