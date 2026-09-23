export function executionAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Sandbox execution aborted.", "AbortError");
}
