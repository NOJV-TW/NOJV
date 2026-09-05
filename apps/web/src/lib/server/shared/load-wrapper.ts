import { error, isHttpError as isSvelteKitError, isRedirect } from "@sveltejs/kit";

import { HttpError } from "../auth";
import { classifyRequestError } from "./handle-action-error";
import type { RequestEvent } from "@sveltejs/kit";

type AnyServerLoad<Event, Output> = (event: Event) => Output | Promise<Output>;

export function handleLoad<
  Event extends Pick<RequestEvent, "request" | "url" | "locals">,
  Output,
>(loader: AnyServerLoad<Event, Output>): (event: Event) => Promise<Output> {
  return async (event: Event): Promise<Output> => {
    try {
      return await loader(event);
    } catch (err) {
      if (isRedirect(err) || (isSvelteKitError(err) && err.status < 500)) {
        throw err;
      }
      if (err instanceof HttpError || isSvelteKitError(err)) {
        const classified = classifyRequestError(err, event);
        error(classified.status, classified.message);
      }
      throw err;
    }
  };
}
