const K8S_CLEANUP_CALL_TIMEOUT_MS = 5_000;
const K8S_CLEANUP_ATTEMPTS = 3;
const K8S_CLEANUP_RETRY_DELAY_MS = 100;

export function k8sErrorCode(reason: unknown): number | null {
  if (reason instanceof Error && reason.cause !== undefined) {
    const causeCode = k8sErrorCode(reason.cause);
    if (causeCode !== null) return causeCode;
  }
  if (typeof reason !== "object" || reason === null || !("code" in reason)) return null;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function isTransientK8sError(reason: unknown): boolean {
  const code = k8sErrorCode(reason);
  return (
    code === null || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
  );
}

export function boundedK8sCall<T>(operation: Promise<T>, resource: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new Error(
              `Kubernetes cleanup call timed out for ${resource} after ${String(K8S_CLEANUP_CALL_TIMEOUT_MS)}ms.`,
            ),
          ),
        ),
      K8S_CLEANUP_CALL_TIMEOUT_MS,
    );
    void operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) =>
        settle(() =>
          reject(
            error instanceof Error
              ? error
              : new Error(`Kubernetes cleanup call failed for ${resource}.`, { cause: error }),
          ),
        ),
    );
  });
}

export async function retryK8sCleanupCall<T>(
  resource: string,
  operation: () => Promise<T>,
  options: { notFoundIsSuccess?: boolean } = {},
): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= K8S_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      return await boundedK8sCall(operation(), resource);
    } catch (error) {
      if (options.notFoundIsSuccess === true && k8sErrorCode(error) === 404) return null;
      lastError = error;
      if (!isTransientK8sError(error) || attempt === K8S_CLEANUP_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, K8S_CLEANUP_RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error(
    `Kubernetes cleanup failed for ${resource} after ${String(K8S_CLEANUP_ATTEMPTS)} attempts: ${failureMessage(lastError)}`,
    { cause: lastError },
  );
}

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
