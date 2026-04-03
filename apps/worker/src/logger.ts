import pino from "pino";

const base = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function createLogger(context: string) {
  const child = base.child({ context });

  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      child.debug(data ?? {}, message),
    info: (message: string, data?: Record<string, unknown>) => child.info(data ?? {}, message),
    warn: (message: string, data?: Record<string, unknown>) => child.warn(data ?? {}, message),
    error: (message: string, data?: Record<string, unknown>) => child.error(data ?? {}, message)
  };
}
