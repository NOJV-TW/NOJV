import { spawn } from "node:child_process";
import type { TestcaseResult } from "../types.js";
import { createBoundedBuffer, createMemoryPoller, withProcessLimit } from "../utils.js";

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
  },
): Promise<RunProcessResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();
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

    const wrapped = withProcessLimit(
      [cmd, ...args],
      options.cpuSeconds === undefined ? undefined : { cpuSeconds: options.cpuSeconds },
    );
    const isWrapped = wrapped[0] === "bash";
    const [wrappedCmd, ...wrappedArgs] = wrapped;
    const proc = spawn(wrappedCmd!, wrappedArgs, {
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: options.timeoutMs,
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    });

    const stdoutBuf = createBoundedBuffer();
    const stderrBuf = createBoundedBuffer();
    const memoryPoller = typeof proc.pid === "number" ? createMemoryPoller(proc.pid) : null;
    let forceKilledViaFallbackTimer = false;

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuf.push(chunk);
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrBuf.push(chunk);
    });

    if (useStdin) {
      proc.stdin!.on("error", () => {}); // Ignore EPIPE when process exits before stdin is consumed
      proc.stdin!.write(options.stdin);
      proc.stdin!.end();
    }

    const timer = setTimeout(() => {
      forceKilledViaFallbackTimer = true;
      proc.kill("SIGKILL");
    }, options.timeoutMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = performance.now() - startTime;
      const memoryKb = memoryPoller?.stop() ?? 0;
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
        timeMs: Math.round(elapsedMs),
        memoryKb,
        timedOut:
          forceKilledViaFallbackTimer || signal === "SIGTERM" || elapsedMs > options.timeoutMs,
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
