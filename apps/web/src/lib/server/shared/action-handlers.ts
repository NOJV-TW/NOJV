import type { RequestEvent } from "@sveltejs/kit";
import { consumeFormRateLimitInternal } from "./rate-limiter";

type RateLimitFailure = NonNullable<Awaited<ReturnType<typeof consumeFormRateLimitInternal>>>;

/**
 * Wraps a SvelteKit form action so it consults the per-IP form rate limiter
 * before running. If the limit is hit, returns the limiter's fail() response
 * directly; otherwise invokes the handler.
 *
 * `E` is generic so we preserve SvelteKit's narrow `params` typing — without
 * it, route-param accessors like `event.params.contestId` would degrade to
 * `string | undefined` inside the wrapped handler.
 */
export function withRateLimit<E extends RequestEvent, R>(
  handler: (event: E) => Promise<R>,
): (event: E) => Promise<R | RateLimitFailure> {
  return async (event) => {
    const limited = await consumeFormRateLimitInternal(event);
    if (limited) return limited;
    return handler(event);
  };
}
