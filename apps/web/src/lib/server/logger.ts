import pino, { type LoggerOptions } from "pino";
import type { RequestEvent } from "@sveltejs/kit";

// In production on GCP (Cloud Run / GKE) emit JSON aligned with the Cloud
// Logging structured-log spec so log entries land with the right severity,
// message, and timestamp instead of being parsed as text payloads.
//
// The two-signal detection (NODE_ENV=production AND one of K_SERVICE /
// GOOGLE_CLOUD_PROJECT) means a local `NODE_ENV=production node ...` run still
// gets the plain pino default JSON, which is friendlier for grep + jq.
const isGcpProduction =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.K_SERVICE ?? process.env.GOOGLE_CLOUD_PROJECT);

// pino numeric level → GCP severity. Cloud Logging accepts these strings
// directly. Anything below debug we still surface as DEBUG.
function pinoLevelToSeverity(level: number): string {
  if (level >= 60) return "CRITICAL";
  if (level >= 50) return "ERROR";
  if (level >= 40) return "WARNING";
  if (level >= 30) return "INFO";
  if (level >= 20) return "DEBUG";
  return "DEBUG";
}

const gcpOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  // Cloud Logging keys off `message` (text payload) and `timestamp`.
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    // Replace pino's numeric `level` with `severity`.
    level(_label, number) {
      return { severity: pinoLevelToSeverity(number) };
    },
    // Flatten everything else to the root: child bindings (`context: ...`)
    // and per-call data are merged with the message payload so they show up
    // as top-level fields in jsonPayload.
    log(record) {
      return record;
    },
  },
  // pid + hostname add noise in Cloud Run where the platform records its own
  // resource metadata; drop them.
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
