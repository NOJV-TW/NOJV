import * as fs from "node:fs/promises";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Cap per-stream buffering so a runaway program printing unbounded output
// cannot OOM-kill the runner before its timeout fires.
const DEFAULT_OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

export interface BoundedBuffer {
  push(chunk: Buffer): void;
  toString(): string;
  get truncated(): boolean;
}

export function createBoundedBuffer(capBytes = DEFAULT_OUTPUT_CAP_BYTES): BoundedBuffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let truncated = false;

  return {
    push(chunk: Buffer): void {
      if (truncated) return;
      const remaining = capBytes - totalBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        totalBytes = capBytes;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    },
    toString(): string {
      const text = Buffer.concat(chunks).toString("utf-8");
      return truncated
        ? `${text}\n[output truncated — exceeded ${String(capBytes)} bytes]`
        : text;
    },
    get truncated() {
      return truncated;
    }
  };
}
