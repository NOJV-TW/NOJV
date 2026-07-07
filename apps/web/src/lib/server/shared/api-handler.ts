import { json, error, isRedirect, isHttpError as isSvelteKitError } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError } from "zod";

import { createLogger } from "../logger";
import { classifyError } from "./handle-action-error";
import { apiRateLimiter, writeApiRateLimiter } from "./rate-limiter";
import { getClientIp } from "./client-ip";

const logger = createLogger("api");

type ApiHandler = (event: RequestEvent) => Promise<Response>;

export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;

export function assertJsonBodyWithinLimit(
  event: RequestEvent,
  maxBytes: number = JSON_BODY_LIMIT_BYTES,
): void {
  const header = event.request.headers.get("content-length");
  if (header === null) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) {
    error(413, "Request body too large");
  }
}

function zodErrorResponse(error: ZodError, event: RequestEvent): Response {
  logger.warn("API validation failed", {
    issues: error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String).join("."),
    })),
    method: event.request.method,
    url: event.url.pathname,
  });
  const first = error.issues[0];
  const path = first?.path.map(String).join(".");
  let message = "Invalid request";
  if (first) {
    message = path ? `${path}: ${first.message}` : first.message;
  }
  return json({ message, issues: error.issues }, { status: 400 });
}

function errorResponse(error: unknown, event: RequestEvent): Response {
  if (error instanceof ZodError) {
    return zodErrorResponse(error, event);
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

function resolveRateLimitKey(event: RequestEvent): string {
  const userId = event.locals.sessionUser?.id ?? event.locals.apiTokenActor?.userId ?? null;
  return userId ? `u:${userId}` : getClientIp(event);
}

function wrapHandler(
  handler: ApiHandler,
  rateLimiter: { consume: (key: string) => Promise<unknown> },
): ApiHandler {
  return async (event) => {
    try {
      await rateLimiter.consume(resolveRateLimitKey(event));
    } catch {
      return json({ message: "Too many requests" }, { status: 429 });
    }

    try {
      return await handler(event);
    } catch (error) {
      if (isRedirect(error) || isSvelteKitError(error)) {
        throw error;
      }
      return errorResponse(error, event);
    }
  };
}

export function apiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, apiRateLimiter);
}

export function writeApiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, writeApiRateLimiter);
}
