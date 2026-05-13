// Cap per-stream buffering so a misbehaving sandbox container printing
// unbounded output cannot OOM-kill the worker before the outer timeout
// fires. Mirrors the helper in apps/sandbox-runner — kept as a separate
// copy because workspace dependencies don't allow cross-app imports.

const DEFAULT_CAP_BYTES = 16 * 1024 * 1024;

export interface BoundedStringBuffer {
  push(chunk: string): void;
  toString(): string;
  get truncated(): boolean;
}

export function createBoundedStringBuffer(capBytes = DEFAULT_CAP_BYTES): BoundedStringBuffer {
  const parts: string[] = [];
  let totalBytes = 0;
  let truncated = false;

  return {
    push(chunk: string): void {
      if (truncated) return;
      const remaining = capBytes - totalBytes;
      const chunkBytes = Buffer.byteLength(chunk, "utf-8");
      if (chunkBytes > remaining) {
        // `chunk.slice(0, remaining)` would slice by UTF-16 code units,
        // not bytes — a chunk of 4-byte UTF-8 characters could overshoot
        // the cap by ~4×. Round-trip through Buffer so the byte count is
        // exact (TextDecoder drops any trailing partial codepoint).
        if (remaining > 0) {
          parts.push(Buffer.from(chunk, "utf-8").subarray(0, remaining).toString("utf-8"));
        }
        totalBytes = capBytes;
        truncated = true;
        return;
      }
      parts.push(chunk);
      totalBytes += chunkBytes;
    },
    toString(): string {
      const text = parts.join("");
      return truncated
        ? `${text}\n[output truncated — exceeded ${String(capBytes)} bytes]`
        : text;
    },
    get truncated() {
      return truncated;
    },
  };
}
