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

/**
 * Spawn a child process, optionally feed stdin, collect stdout/stderr,
 * and enforce a timeout with a fallback SIGKILL.
 */
export function runProcess(
  command: string[],
  options: { stdin?: string; timeoutMs: number; env?: Record<string, string> },
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

    const [wrappedCmd, ...wrappedArgs] = withProcessLimit([cmd, ...args]);
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

    // Fallback timer in case spawn timeout doesn't fire
    const timer = setTimeout(() => {
      forceKilledViaFallbackTimer = true;
      proc.kill("SIGKILL");
    }, options.timeoutMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      // Compare against the raw float elapsed to avoid round-up false TLEs:
      // a process that finishes at 999.6ms (rounded to 1000) must not be
      // classified as TLE when the limit is 1000ms. The spawn-level timeout
      // and the SIGKILL fallback are the authoritative cut-offs.
      const elapsedMs = performance.now() - startTime;
      const memoryKb = memoryPoller?.stop() ?? 0;
      resolve({
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        exitCode: code ?? -1,
        timeMs: Math.round(elapsedMs),
        memoryKb,
        timedOut:
          forceKilledViaFallbackTimer || signal === "SIGTERM" || elapsedMs > options.timeoutMs,
        signal,
        spawnError: false,
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

/** Classify a solution run into an error verdict (SE/TLE/MLE/RE), or `null` if it succeeded. */
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
