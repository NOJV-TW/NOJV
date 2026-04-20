import type { RequestEvent } from "@sveltejs/kit";
import { consumeFormRateLimit } from "./rate-limiter";

type RateLimitFailure = NonNullable<Awaited<ReturnType<typeof consumeFormRateLimit>>>;

/**
 * Wraps a SvelteKit form action so it consults the per-IP form rate limiter
 * before running. If the limit is hit, returns the limiter's fail() response
 * directly; otherwise invokes the handler.
 */
export function withRateLimit<R>(
  handler: (event: RequestEvent) => Promise<R>,
): (event: RequestEvent) => Promise<R | RateLimitFailure> {
  return async (event) => {
    const limited = await consumeFormRateLimit(event);
    if (limited) return limited;
    return handler(event);
  };
}
