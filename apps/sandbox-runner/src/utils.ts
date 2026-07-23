import * as fs from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

export function readCgroupMemoryCurrentBytes(): number | null {
  return parseCgroupMemoryBytes(safeReadFile("/sys/fs/cgroup/memory.current"));
}

export function cleanupTempDir(dir: string): Promise<void> {
  return fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export interface MemoryPoller {
  stop(): number;
}

export const MEMORY_POLL_INTERVAL_MS = 25;

function readPpid(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf-8");
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number.parseInt(afterComm[1] ?? "", 10);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

function readVmRssKb(pid: number): number {
  try {
    const status = readFileSync(`/proc/${String(pid)}/status`, "utf-8");
    const match = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    return match ? Number.parseInt(match[1] ?? "", 10) : 0;
  } catch {
    return 0;
  }
}

function processSubtree(root: number): number[] {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [root];
  }

  const childrenOf = new Map<number, number[]>();
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    const ppid = readPpid(pid);
    if (ppid === null) continue;
    const siblings = childrenOf.get(ppid) ?? [];
    siblings.push(pid);
    childrenOf.set(ppid, siblings);
  }

  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return out;
}

export function createMemoryPoller(pid: number): MemoryPoller {
  let peakKb = 0;
  let stopped = false;

  function sample(): void {
    if (stopped) return;
    let sumKb = 0;
    for (const member of processSubtree(pid)) {
      sumKb += readVmRssKb(member);
    }
    if (Number.isFinite(sumKb) && sumKb > peakKb) peakKb = sumKb;
  }

  sample();
  const interval = setInterval(sample, MEMORY_POLL_INTERVAL_MS);

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

export function withCpuTimeLimit(
  command: [string, ...string[]],
  opts?: { cpuSeconds?: number },
): [string, ...string[]] {
  const cpuSeconds = opts?.cpuSeconds;
  if (cpuSeconds === undefined || !Number.isFinite(cpuSeconds) || cpuSeconds <= 0) {
    return command;
  }
  return [
    "bash",
    "-c",
    `ulimit -t ${String(Math.ceil(cpuSeconds))}; exec "$@"`,
    "--",
    ...command,
  ];
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
