import { json, isRedirect, isHttpError as isSvelteKitError } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError } from "zod";

import { HttpError } from "../auth";
import { createLogger } from "../logger";

const logger = createLogger("api");

type ApiHandler = (event: RequestEvent) => Promise<Response>;

export function apiHandler(handler: ApiHandler): ApiHandler {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      if (isRedirect(error) || isSvelteKitError(error)) {
        throw error;
      }

      if (error instanceof ZodError) {
        return json({ issues: error.issues }, { status: 400 });
      }

      if (error instanceof HttpError) {
        return json({ message: error.message }, { status: error.status });
      }

      logger.error("Unhandled API error", {
        err: error instanceof Error ? error.message : String(error),
        method: event.request.method,
        url: event.url.pathname
      });

      return json({ message: "Internal server error." }, { status: 500 });
    }
  };
}
