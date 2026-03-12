type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>) {
  const entry = {
    context,
    level,
    message,
    timestamp: new Date().toISOString(),
    ...data
  };

  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => log("debug", context, message, data),
    error: (message: string, data?: Record<string, unknown>) => log("error", context, message, data),
    info: (message: string, data?: Record<string, unknown>) => log("info", context, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log("warn", context, message, data)
  };
}
