import { fail, isHttpError as isSvelteKitError, isRedirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { consumeFormRateLimitInternal } from "./rate-limiter";
import { classifyError } from "./handle-action-error";

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

export function withAction<E extends RequestEvent, R>(
  handler: (event: E) => Promise<R>,
): (event: E) => Promise<R | ReturnType<typeof fail>> {
  return withRateLimit(async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (isRedirect(err) || isSvelteKitError(err)) throw err;
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
  });
}
