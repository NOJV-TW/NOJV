import pino, { type LoggerOptions } from "pino";
import type { RequestEvent } from "@sveltejs/kit";

// In production on GCP (Cloud Run / GKE) we emit JSON aligned with Cloud
// Logging's structured-log spec so entries land with the right severity,
// message, and timestamp instead of being parsed as a text payload.
// The two-signal detection means a local `NODE_ENV=production node ...` run
// still gets plain pino JSON, which is friendlier for grep + jq.
const isGcpProduction =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.K_SERVICE ?? process.env.GOOGLE_CLOUD_PROJECT);

function pinoLevelToSeverity(level: number): string {
  if (level >= 60) return "CRITICAL";
  if (level >= 50) return "ERROR";
  if (level >= 40) return "WARNING";
  if (level >= 30) return "INFO";
  return "DEBUG";
}

const gcpOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level(_label, number) {
      return { severity: pinoLevelToSeverity(number) };
    },
    log(record) {
      return record;
    },
  },
  // Cloud Run records its own resource metadata; pid + hostname are noise.
  base: null,
};

const devOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
};

const base = pino(isGcpProduction ? gcpOptions : devOptions);

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
