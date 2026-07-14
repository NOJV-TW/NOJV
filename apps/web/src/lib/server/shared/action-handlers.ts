import { fail, isHttpError as isSvelteKitError, isRedirect } from "@sveltejs/kit";
import type { ActionFailure, RequestEvent } from "@sveltejs/kit";
import { consumeFormRateLimitInternal } from "./rate-limiter";
import { classifyError } from "./handle-action-error";

type RateLimitFailure = NonNullable<Awaited<ReturnType<typeof consumeFormRateLimitInternal>>>;
type RequestAction = (event: RequestEvent) => Promise<unknown>;
type RateLimitedActions<A extends Record<string, RequestAction>> = {
  [K in keyof A]: A[K] extends (event: infer E) => Promise<infer R>
    ? E extends RequestEvent
      ? (event: E) => Promise<R | RateLimitFailure>
      : never
    : never;
};

export function withRateLimit<E extends RequestEvent, R>(
  handler: (event: E) => Promise<R>,
): (event: E) => Promise<R | RateLimitFailure> {
  return async (event) => {
    const limited = await consumeFormRateLimitInternal(event);
    if (limited) return limited;
    return handler(event);
  };
}

export function withRateLimitActions<A extends Record<string, RequestAction>>(
  actions: A,
): RateLimitedActions<A> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [name, withRateLimit(action)]),
  ) as RateLimitedActions<A>;
}

export function withAction<E extends RequestEvent, R>(handler: (event: E) => Promise<R>) {
  return withRateLimit(async (event: E): Promise<R | ActionFailure<{ error: string }>> => {
    try {
      return await handler(event);
    } catch (err) {
      if (isRedirect(err) || isSvelteKitError(err)) throw err;
      const classified = classifyError(err);
      return fail(classified.status, { error: classified.message });
    }
  });
}
