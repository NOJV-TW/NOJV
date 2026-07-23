import { spawn } from "node:child_process";
import type { TestcaseResult } from "../types.js";
import {
  createBoundedBuffer,
  createMemoryPoller,
  readCgroupCpuUsageUsec,
  readCgroupMemoryCurrentBytes,
  readCgroupMemoryPeakBytes,
  withCpuTimeLimit,
} from "../utils.js";

const WALL_GRACE_FACTOR = 2;
const ignoreStreamError = () => undefined;

export interface RunProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  memoryKb: number;
  timedOut: boolean;
  signal: string | null;
  spawnError: boolean;
}

export function runProcess(
  command: string[],
  options: {
    stdin?: string;
    timeoutMs: number;
    env?: Record<string, string>;
    cpuSeconds?: number;
    measureCgroupMemoryPeak?: boolean;
  },
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const startCpuUsec = readCgroupCpuUsageUsec();
    const memBaselineBytes = options.measureCgroupMemoryPeak
      ? readCgroupMemoryCurrentBytes()
      : null;
    const startTime = performance.now();
    const wallBudgetMs = options.timeoutMs * WALL_GRACE_FACTOR;
    const [cmd, ...args] = command;

    if (!cmd) {
      resolve({
        stdout: "",
        stderr: "Empty run command.",
        exitCode: -1,
        timeMs: 0,
        memoryKb: 0,
        timedOut: false,
        signal: null,
        spawnError: true,
      });
      return;
    }

    const useStdin = options.stdin !== undefined;

    const wrapped = withCpuTimeLimit(
      [cmd, ...args],
      options.cpuSeconds === undefined ? undefined : { cpuSeconds: options.cpuSeconds },
    );
    const isWrapped = wrapped[0] === "bash";
    const [wrappedCmd, ...wrappedArgs] = wrapped;
    const proc = spawn(wrappedCmd, wrappedArgs, {
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: wallBudgetMs,
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    });

    const stdoutBuf = createBoundedBuffer();
    const stderrBuf = createBoundedBuffer();
    const memoryPoller = typeof proc.pid === "number" ? createMemoryPoller(proc.pid) : null;
    let forceKilledViaFallbackTimer = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf.push(chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf.push(chunk);
    });

    if (useStdin) {
      proc.stdin?.on("error", ignoreStreamError);
      proc.stdin?.write(options.stdin);
      proc.stdin?.end();
    }

    const timer = setTimeout(() => {
      forceKilledViaFallbackTimer = true;
      proc.kill("SIGKILL");
    }, wallBudgetMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = performance.now() - startTime;
      const endCpuUsec = readCgroupCpuUsageUsec();
      const cpuMs =
        startCpuUsec !== null && endCpuUsec !== null
          ? Math.max(0, Math.round((endCpuUsec - startCpuUsec) / 1000))
          : null;
      const judgedMs = cpuMs ?? elapsedMs;
      const pollerKb = memoryPoller?.stop() ?? 0;
      let memoryKb = pollerKb;
      if (options.measureCgroupMemoryPeak && memBaselineBytes !== null) {
        const peakAfter = readCgroupMemoryPeakBytes();
        if (peakAfter !== null) {
          const cgroupKb = Math.max(0, Math.round((peakAfter - memBaselineBytes) / 1024));
          memoryKb = Math.max(pollerKb, cgroupKb);
        }
      }
      const rawStderr = stderrBuf.toString();
      const execFailed =
        isWrapped &&
        (code === 126 || code === 127) &&
        (/exec: .*: (cannot execute|not found)/.test(rawStderr) ||
          /: line \d+: \S+: (No such file or directory|Permission denied|cannot execute|not found)/.test(
            rawStderr,
          ));
      const stderr = execFailed ? `Failed to spawn process: ${rawStderr}` : rawStderr;
      resolve({
        stdout: stdoutBuf.toString(),
        stderr,
        exitCode: code ?? -1,
        timeMs: Math.round(judgedMs),
        memoryKb,
        timedOut:
          forceKilledViaFallbackTimer ||
          signal === "SIGTERM" ||
          signal === "SIGXCPU" ||
          judgedMs > options.timeoutMs,
        signal,
        spawnError: execFailed,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      const memoryKb = memoryPoller?.stop() ?? 0;
      resolve({
        stdout: "",
        stderr: `Failed to spawn process: ${err.message}`,
        exitCode: -1,
        timeMs: Math.round(performance.now() - startTime),
        memoryKb,
        timedOut: false,
        signal: null,
        spawnError: true,
      });
    });
  });
}

export function classifySolutionVerdict(
  result: RunProcessResult,
  testcaseIndex: number,
): TestcaseResult | null {
  const base = {
    index: testcaseIndex,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    ...(result.memoryKb > 0 ? { memoryKb: result.memoryKb } : {}),
  };

  if (result.spawnError) return { ...base, verdict: "SE" };
  if (result.timedOut) return { ...base, verdict: "TLE" };
  if (result.signal === "SIGKILL") return { ...base, verdict: "MLE" };
  if (result.exitCode !== 0) return { ...base, verdict: "RE" };
  return null;
}
