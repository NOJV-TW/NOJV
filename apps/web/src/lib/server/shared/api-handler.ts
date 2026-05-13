import { json, isRedirect, isHttpError as isSvelteKitError } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError } from "zod";

import { createLogger } from "../logger";
import { classifyError } from "./handle-action-error";
import { apiRateLimiter, writeApiRateLimiter } from "./rate-limiter";
import { getClientIp } from "./client-ip";

const logger = createLogger("api");

type ApiHandler = (event: RequestEvent) => Promise<Response>;

function wrapHandler(
  handler: ApiHandler,
  rateLimiter: { consume: (key: string) => Promise<unknown> },
): ApiHandler {
  return async (event) => {
    const ip = getClientIp(event);

    try {
      await rateLimiter.consume(ip);
    } catch {
      return json({ error: "Too many requests" }, { status: 429 });
    }

    try {
      return await handler(event);
    } catch (error) {
      if (isRedirect(error) || isSvelteKitError(error)) {
        throw error;
      }

      if (error instanceof ZodError) {
        logger.warn("API validation failed", {
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path.map((segment) => String(segment)).join("."),
          })),
          method: event.request.method,
          url: event.url.pathname,
        });
        const first = error.issues[0];
        const path = first?.path.map((s) => String(s)).join(".");
        const message = first
          ? path
            ? `${path}: ${first.message}`
            : first.message
          : "Invalid request";
        return json({ message, issues: error.issues }, { status: 400 });
      }

      const classified = classifyError(error);

      if (classified.type === "unknown") {
        logger.error("Unhandled API error", {
          err: error instanceof Error ? error.message : String(error),
          method: event.request.method,
          stack: error instanceof Error ? error.stack : undefined,
          url: event.url.pathname,
        });
      }

      return json({ message: classified.message }, { status: classified.status });
    }
  };
}

/** Wrap a read API handler with general rate limiting + error handling. */
export function apiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, apiRateLimiter);
}

/** Wrap a write API handler with stricter rate limiting + error handling. */
export function writeApiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, writeApiRateLimiter);
}
