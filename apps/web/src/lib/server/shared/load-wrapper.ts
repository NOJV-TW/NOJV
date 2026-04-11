import { error, isHttpError as isSvelteKitError, isRedirect } from "@sveltejs/kit";

import { HttpError } from "../auth";

/**
 * Minimal structural type matching SvelteKit's `ServerLoad` / `LayoutServerLoad`
 * shape. Kept local so `handleLoad` can accept the per-route `PageServerLoad`
 * / `LayoutServerLoad` aliases generated under `./$types` without having to
 * re-parameterise across the full `ServerLoad<Params, ParentData, Output,
 * RouteId>` tuple at every call site.
 */
type AnyServerLoad<Event, Output> = (event: Event) => Output | Promise<Output>;

/**
 * Wraps a SvelteKit `+page.server.ts` / `+layout.server.ts` load function so
 * that domain `HttpError`s thrown from the body are converted into the
 * expected SvelteKit `error(status, message)` response.
 *
 * SvelteKit's load-function error path is strict: only `error()` calls
 * generate 4xx responses; anything else becomes a 500 that `handleError`
 * logs as unexpected. Wrapping load bodies here keeps business-logic
 * throws (e.g. `NotFoundError`, `ForbiddenError`) honest without
 * requiring every caller to re-implement `if (!x) error(404, ...)`.
 *
 * Redirects and SvelteKit's own `HttpError` (from calls to `error()` /
 * `redirect()`) are re-thrown untouched.
 */
export function handleLoad<Event, Output>(
  loader: AnyServerLoad<Event, Output>
): (event: Event) => Promise<Output> {
  return async (event: Event): Promise<Output> => {
    try {
      return await loader(event);
    } catch (err) {
      if (isRedirect(err) || isSvelteKitError(err)) {
        throw err;
      }
      if (err instanceof HttpError) {
        error(err.status, err.message);
      }
      throw err;
    }
  };
}
