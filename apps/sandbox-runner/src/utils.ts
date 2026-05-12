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

export interface MemoryPoller {
  /** Stop polling and return the peak resident set size observed, in KB. */
  stop(): number;
}

/**
 * Sample `/proc/<pid>/status` to track a child process's peak resident
 * memory (VmHWM, in KB). Linux-only — `/proc` is not present on macOS
 * dev hosts, but sandbox-runner always executes inside an Alpine container
 * regardless of where the developer runs `pnpm dev`, so the data path is
 * guaranteed in practice.
 *
 * Reads happen on a 50 ms interval, plus one synchronous read at start
 * time so processes that finish before the first tick still get a sample.
 */
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
      // One final sample in case the process is still alive at stop time
      // and VmHWM grew past the last tick.
      sample();
      return peakKb;
    },
  };
}

// Cap per-stream buffering so a runaway program printing unbounded output
// cannot OOM-kill the runner before its timeout fires.
const DEFAULT_OUTPUT_CAP_BYTES = 16 * 1024 * 1024;

export interface BoundedBuffer {
  push(chunk: Buffer): void;
  toString(): string;
  get truncated(): boolean;
}

/**
 * Wrap a spawn command with `ulimit -u N` so the resulting process tree
 * cannot exceed N processes for the sandbox UID. Primary defence against
 * fork-bomb submissions — seccomp `RuntimeDefault` permits `clone()`, and
 * dropping capabilities does not restrict fork(), so an application-layer
 * rlimit is the only thing that actually bounds process count.
 *
 * Gated on `SANDBOX_NPROC_LIMIT` env. The sandbox Docker image sets this;
 * local dev and CI do not, because `RLIMIT_NPROC` is per-UID system-wide —
 * setting it to 64 on a dev laptop that already runs hundreds of processes
 * as the same user would EAGAIN every child spawn.
 *
 * Uses `bash -c 'ulimit -u N; exec "$@"' --` rather than `prlimit(1)` to
 * avoid pulling util-linux into the Alpine image; bash is already present
 * for shell-invoked toolchains.
 */
export function withProcessLimit(command: string[]): string[] {
  const raw = process.env.SANDBOX_NPROC_LIMIT;
  if (!raw) return command;
  const nproc = Number(raw);
  if (!Number.isFinite(nproc) || nproc <= 0) return command;
  return ["bash", "-c", `ulimit -u ${String(nproc)}; exec "$@"`, "--", ...command];
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
