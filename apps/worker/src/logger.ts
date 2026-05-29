import pino, { type LoggerOptions } from "pino";

const isGcpProduction =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.K_SERVICE ?? process.env.GOOGLE_CLOUD_PROJECT);

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

export function createLogger(context: string) {
  const child = base.child({ context });

  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      child.debug(data ?? {}, message),
    info: (message: string, data?: Record<string, unknown>) => child.info(data ?? {}, message),
    warn: (message: string, data?: Record<string, unknown>) => child.warn(data ?? {}, message),
    error: (message: string, data?: Record<string, unknown>) =>
      child.error(data ?? {}, message),
  };
}
