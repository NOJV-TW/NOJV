import pino from "pino";
import type { RequestEvent } from "@sveltejs/kit";

const base = pino({ level: process.env.LOG_LEVEL ?? "info" });

export interface Logger {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

function wrap(child: pino.Logger): Logger {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      child.debug(data ?? {}, message),
    info: (message: string, data?: Record<string, unknown>) => child.info(data ?? {}, message),
    warn: (message: string, data?: Record<string, unknown>) => child.warn(data ?? {}, message),
    error: (message: string, data?: Record<string, unknown>) =>
      child.error(data ?? {}, message),
  };
}

export function createLogger(context: string): Logger {
  return wrap(base.child({ context }));
}

/**
 * Returns a logger child that automatically tags every log line with the
 * request's correlation id (set by hooks.server.ts on `event.locals.requestId`).
 * Falls back to a regular logger when `requestId` is missing (e.g. background work).
 */
export function getLogger(
  context: string,
  event: Pick<RequestEvent, "locals"> | { locals: { requestId?: string } },
): Logger {
  const requestId = event.locals.requestId;
  const bindings: Record<string, string> = { context };
  if (typeof requestId === "string" && requestId.length > 0) {
    bindings.requestId = requestId;
  }
  return wrap(base.child(bindings));
}
