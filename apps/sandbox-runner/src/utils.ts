import * as fs from "node:fs/promises";

/** Return true iff `filePath` is accessible to the current process. */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default per-stream output cap. The sandbox runs inside a memory-limited
 * container; without a cap, a runaway program that prints unbounded output
 * (e.g., an infinite loop with `printf`) would buffer the entire stream
 * into a `Buffer[]` and OOM-kill the runner before the timeout fires.
 */
const DEFAULT_OUTPUT_CAP_BYTES = 16 * 1024 * 1024; // 16 MB

export interface BoundedBuffer {
  push(chunk: Buffer): void;
  toString(): string;
  get truncated(): boolean;
}

/**
 * Collect chunks up to `capBytes`, truncating any excess. Once the cap is
 * reached, subsequent chunks are dropped — the child process keeps running
 * (so timeouts and exit codes still work) but its output stops accumulating.
 */
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
