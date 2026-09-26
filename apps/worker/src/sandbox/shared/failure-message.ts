export function failureMessage(reason: unknown): string {
  if (reason instanceof Error) {
    const cause = reason.cause;
    return cause === undefined
      ? reason.message
      : `${reason.message} Caused by: ${failureMessage(cause)}`;
  }
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof reason === "string") return reason;
  if (reason === undefined) return "undefined";
  if (typeof reason === "number" || typeof reason === "boolean") return String(reason);
  if (typeof reason === "bigint") return reason.toString();
  if (typeof reason === "function") return `function ${reason.name || "anonymous"}`;
  if (typeof reason === "symbol") return reason.description ?? "symbol";
  try {
    return JSON.stringify(reason);
  } catch {
    return "unserializable failure";
  }
}
