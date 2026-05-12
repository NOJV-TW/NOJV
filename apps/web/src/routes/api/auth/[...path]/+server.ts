import type { RequestHandler } from "@sveltejs/kit";
import { toSvelteKitHandler } from "better-auth/svelte-kit";

import { getAuth } from "$lib/auth.server";
import { createLogger } from "$lib/server/logger";

const logger = createLogger("auth-route");

let _authHandler: RequestHandler | null = null;

function getAuthHandler(): RequestHandler {
  _authHandler ??= toSvelteKitHandler(getAuth());
  return _authHandler;
}

const REDACTED_QUERY_KEYS = new Set(["code", "state", "token", "id_token", "access_token"]);

function redactQuery(params: URLSearchParams): string {
  const safe = new URLSearchParams();
  for (const [key, value] of params) {
    safe.append(key, REDACTED_QUERY_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value);
  }
  return safe.toString();
}

const handleAuth: RequestHandler = async (event) => {
  try {
    return await getAuthHandler()(event);
  } catch (error) {
    logger.error("Auth route failed", {
      error: error instanceof Error ? error.message : String(error),
      method: event.request.method,
      path: event.url.pathname,
      provider: event.url.pathname.split("/").at(-1) ?? null,
      query: redactQuery(event.url.searchParams),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

export const GET: RequestHandler = handleAuth;

export const POST: RequestHandler = handleAuth;
