import pino, { type LoggerOptions } from "pino";

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
