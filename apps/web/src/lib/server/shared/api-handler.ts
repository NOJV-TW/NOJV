import { json, error, isRedirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError } from "zod";

import { classifyRequestError } from "./handle-action-error";
import {
  apiRateLimiter,
  registryTokenRateLimiter,
  writeApiRateLimiter,
  type RateLimiterLike,
} from "./rate-limiter";
import { getClientIp } from "./client-ip";

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

async function readBodyTextWithinLimit(request: Request, maxBytes: number): Promise<string> {
  const stream = request.body;
  if (stream === null) return request.text();

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      error(413, "Request body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export async function readJsonBody(
  event: RequestEvent,
  maxBytes: number = JSON_BODY_LIMIT_BYTES,
): Promise<unknown> {
  const text = await readBodyTextWithinLimit(event.request, maxBytes);
  try {
    return JSON.parse(text);
  } catch (reason) {
    if (!(reason instanceof SyntaxError)) throw reason;
    error(400, "Invalid request body: expected valid JSON.");
  }
}

function errorResponse(error: unknown, event: RequestEvent): Response {
  const classified = classifyRequestError(error, event);
  return json(
    {
      message: classified.message,
      ...(error instanceof ZodError ? { issues: error.issues } : {}),
    },
    { status: classified.status },
  );
}

function resolveRateLimitKey(event: RequestEvent): string {
  const userId = event.locals.sessionUser?.id ?? event.locals.apiTokenActor?.userId ?? null;
  return userId ? `u:${userId}` : getClientIp(event);
}

function wrapHandler(handler: ApiHandler, rateLimiter: RateLimiterLike): ApiHandler {
  return async (event) => {
    const rateLimit = await rateLimiter.consume(resolveRateLimitKey(event));
    if (rateLimit === "limited") {
      return json({ message: "Too many requests" }, { status: 429 });
    }
    if (rateLimit === "unavailable") {
      return json({ message: "Rate limiter unavailable" }, { status: 503 });
    }

    try {
      return await handler(event);
    } catch (error) {
      if (isRedirect(error)) {
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

export function registryTokenApiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, registryTokenRateLimiter);
}
