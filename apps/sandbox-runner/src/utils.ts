import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function cleanupTempDir(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export interface MemoryPoller {
  stop(): number;
}

export function createMemoryPoller(pid: number): MemoryPoller {
  let peakKb = 0;
  let stopped = false;

  function sample(): void {
    if (stopped) return;
    try {
      const status = readFileSync(`/proc/${String(pid)}/status`, "utf-8");
      const match = status.match(/^VmHWM:\s+(\d+)\s+kB/m);
      if (match) {
        const kb = Number.parseInt(match[1]!, 10);
        if (Number.isFinite(kb) && kb > peakKb) peakKb = kb;
      }
    } catch {
      // Process gone, or /proc unavailable on this host. Either way, just
      // stop accumulating — the last known peak is still valid.
    }
  }

  sample();
  const interval = setInterval(sample, 50);

  return {
    stop(): number {
      stopped = true;
      clearInterval(interval);
      sample();
      return peakKb;
    },
  };
}

const DEFAULT_OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

export interface BoundedBuffer {
  push(chunk: Buffer): void;
  toString(): string;
  get truncated(): boolean;
}

export function withProcessLimit(command: string[], opts?: { cpuSeconds?: number }): string[] {
  const limits: string[] = [];

  const rawNproc = process.env.SANDBOX_NPROC_LIMIT;
  if (rawNproc) {
    const nproc = Number(rawNproc);
    if (Number.isFinite(nproc) && nproc > 0) limits.push(`ulimit -u ${String(nproc)}`);
  }

  const cpuSeconds = opts?.cpuSeconds;
  if (cpuSeconds !== undefined && Number.isFinite(cpuSeconds) && cpuSeconds > 0) {
    limits.push(`ulimit -t ${String(Math.ceil(cpuSeconds))}`);
  }

  if (limits.length === 0) return command;
  return ["bash", "-c", `${limits.join("; ")}; exec "$@"`, "--", ...command];
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
    },
  };
}
