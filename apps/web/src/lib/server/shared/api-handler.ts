import { json, error, isRedirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { ZodError, type ZodType } from "zod";
import { HttpError } from "@nojv/application";

import { classifyRequestError } from "./handle-action-error";
import {
  apiRateLimiter,
  draftApiRateLimiter,
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

export async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Buffer<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) error(413, "Request body too large");
  const stream = request.body;
  if (stream === null) return Buffer.alloc(0);

  const reader = stream.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        error(413, "Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, received);
}

export async function readFormData(event: RequestEvent, maxBytes: number): Promise<FormData> {
  const body = await readBodyWithinLimit(event.request, maxBytes);
  return new Response(body, { headers: event.request.headers }).formData().catch(() => {
    error(400, "Invalid request body: expected form data.");
  });
}

export async function readJsonBody(
  event: RequestEvent,
  maxBytes: number = JSON_BODY_LIMIT_BYTES,
): Promise<unknown> {
  const text = new TextDecoder().decode(await readBodyWithinLimit(event.request, maxBytes));
  try {
    return JSON.parse(text);
  } catch (reason) {
    if (!(reason instanceof SyntaxError)) throw reason;
    error(400, "Invalid request body: expected valid JSON.");
  }
}

export function parseJsonContextParam(raw: string | null): unknown {
  if (raw === null) throw new HttpError("context is required.", 400);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError("context must be JSON.", 400);
  }
}

export function parseContextQuery<T>(url: URL, schema: ZodType<T>): T {
  const type = url.searchParams.get("type");
  if (!type) return schema.parse({ type });
  const idParam = `${type}Id`;
  return schema.parse({ type, [idParam]: url.searchParams.get(idParam) });
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

export function draftApiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, draftApiRateLimiter);
}

export function registryTokenApiHandler(handler: ApiHandler): ApiHandler {
  return wrapHandler(handler, registryTokenRateLimiter);
}
