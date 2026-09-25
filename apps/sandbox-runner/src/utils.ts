import { MAX_EXECUTION_OUTPUT_BYTES } from "@nojv/core";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function findScript(dir: string, prefix: string): Promise<string | null> {
  const match = (await fs.readdir(dir)).find((entry) => entry.startsWith(`${prefix}.`));
  return match ? path.join(dir, match) : null;
}

export function readOptionalFile(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, "utf-8").catch(() => undefined);
}

export function parseCgroupCpuUsageUsec(
  v2Stat: string | null,
  v1Nanos: string | null,
): number | null {
  if (v2Stat) {
    const match = /^usage_usec\s+(\d+)/m.exec(v2Stat);
    if (match) return Number(match[1]);
  }
  if (v1Nanos) {
    const nanos = Number(v1Nanos.trim());
    if (Number.isFinite(nanos) && nanos >= 0) return Math.round(nanos / 1000);
  }
  return null;
}

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function readCgroupCpuUsageUsec(): number | null {
  return parseCgroupCpuUsageUsec(
    safeReadFile("/sys/fs/cgroup/cpu.stat"),
    safeReadFile("/sys/fs/cgroup/cpuacct/cpuacct.usage"),
  );
}

export function parseCgroupMemoryBytes(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function readCgroupMemoryPeakBytes(): number | null {
  return parseCgroupMemoryBytes(safeReadFile("/sys/fs/cgroup/memory.peak"));
}

export function cleanupTempDir(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

const DEFAULT_OUTPUT_CAP_BYTES = MAX_EXECUTION_OUTPUT_BYTES;

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
    },
  };
}

export function readCgroupThrottledUsec(): number | null {
  const stat = safeReadFile("/sys/fs/cgroup/cpu.stat");
  const match = stat && /^throttled_usec\s+(\d+)/m.exec(stat);
  return match ? Number(match[1]) : null;
}
