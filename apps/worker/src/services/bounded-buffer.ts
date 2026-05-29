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
