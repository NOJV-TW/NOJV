import { error, isHttpError as isSvelteKitError, isRedirect } from "@sveltejs/kit";

import { HttpError } from "../auth";

type AnyServerLoad<Event, Output> = (event: Event) => Output | Promise<Output>;

export function handleLoad<Event, Output>(
  loader: AnyServerLoad<Event, Output>,
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
