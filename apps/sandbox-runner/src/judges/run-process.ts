import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { Readable } from "node:stream";
import { MAX_EXECUTION_OUTPUT_BYTES, executionWallTimeLimitMs } from "@nojv/core";
import { z } from "zod";
import type { SandboxTestcaseResult } from "@nojv/core";
import { createBoundedBuffer } from "../utils.js";

const ignoreStreamError = () => undefined;

const HELPER_GRACE_MS = 2_000;

const execReportSchema = z.object({
  cpuUs: z.number().int().nonnegative(),
  maxRssKb: z.number().int().nonnegative(),
  peakGroupKb: z.number().int().nonnegative(),
  killed: z.enum(["none", "wall", "term", "memory"]),
  exitCode: z.number().int().optional(),
  signal: z.number().int().optional(),
  execErrno: z.number().int().optional(),
});

const signalNames = new Map(Object.entries(constants.signals).map(([name, n]) => [n, name]));
const errnoNames = new Map(Object.entries(constants.errno).map(([name, n]) => [n, name]));

export interface RunProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  memoryKb: number;
  timedOut: boolean;
  signal: string | null;
  spawnError: boolean;
  outputLimitExceeded: boolean;
}

function spawnFailure(stderr: string, memoryKb = 0): RunProcessResult {
  return {
    stdout: "",
    stderr,
    exitCode: -1,
    timeMs: 0,
    memoryKb,
    timedOut: false,
    signal: null,
    spawnError: true,
    outputLimitExceeded: false,
  };
}

function parseExecReport(text: string) {
  try {
    const parsed = execReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface MeasuredOptions {
  timeoutMs: number;
  env?: Record<string, string>;
  cpuSeconds?: number;
  memoryLimitMb?: number;
  cwd?: string;
}

interface MeasuredOutcome {
  report: ExecReport | null;
  failure: string | null;
  supervisor: "killed" | "timed-out" | null;
  memoryKb: number;
}

export interface MeasuredProcess {
  proc: ChildProcess;
  finished: Promise<MeasuredOutcome>;
}

type ExecReport = z.infer<typeof execReportSchema>;

const liveHelpers = new Set<number>();

function parentPid(pid: string): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const [state, ppid] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return state === "Z" ? null : Number(ppid);
  } catch {
    return null;
  }
}

function reapOrphans(): void {
  if (process.pid !== 1) return;
  for (let round = 0; round < 10; round++) {
    const orphans = readdirSync("/proc").filter(
      (entry) =>
        /^\d+$/.test(entry) && !liveHelpers.has(Number(entry)) && parentPid(entry) === 1,
    );
    if (orphans.length === 0) return;
    for (const pid of orphans) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        continue;
      }
    }
  }
}

export function spawnMeasured(
  command: [string, ...string[]],
  options: MeasuredOptions & { stdin: "pipe" | "ignore" },
): MeasuredProcess {
  const wallBudgetMs = executionWallTimeLimitMs(options.timeoutMs);
  const proc = spawn(
    process.env.NOJV_EXEC_PATH ?? "/usr/local/bin/nojv-exec",
    [
      String(Math.ceil(options.cpuSeconds ?? 0)),
      String(wallBudgetMs),
      String(Math.round((options.memoryLimitMb ?? 0) * 1024)),
      "--",
      ...command,
    ],
    {
      stdio: [options.stdin, "pipe", "pipe", "pipe"],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
    },
  );
  const reportChunks: Buffer[] = [];
  const reportStream = proc.stdio[3];
  if (reportStream instanceof Readable) {
    reportStream.on("data", (chunk: Buffer) => reportChunks.push(chunk));
  }
  let supervisorTimedOut = false;
  const timer = setTimeout(() => {
    supervisorTimedOut = true;
    proc.kill("SIGKILL");
  }, wallBudgetMs + HELPER_GRACE_MS);
  const helperPid = proc.pid;
  if (helperPid !== undefined) liveHelpers.add(helperPid);
  proc.once("exit", (code) => {
    if (helperPid !== undefined) liveHelpers.delete(helperPid);
    if (code === 0) return;
    reapOrphans();
    setTimeout(() => {
      for (const stream of proc.stdio) stream?.destroy();
    }, 1_000).unref();
  });
  const finished = new Promise<MeasuredOutcome>((resolve) => {
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const report = parseExecReport(Buffer.concat(reportChunks).toString());
      if (!report && signal !== null) {
        resolve({
          report: null,
          failure: null,
          supervisor: supervisorTimedOut ? "timed-out" : "killed",
          memoryKb: 0,
        });
      } else if (!report) {
        resolve({
          report: null,
          failure: `Execution helper failed (exit ${String(code)}).`,
          supervisor: null,
          memoryKb: 0,
        });
      } else if (report.execErrno !== undefined) {
        resolve({
          report: null,
          failure: `Failed to spawn process: ${errnoNames.get(report.execErrno) ?? String(report.execErrno)}`,
          supervisor: null,
          memoryKb: 0,
        });
      } else {
        resolve({
          report,
          failure: null,
          supervisor: null,
          memoryKb: Math.max(report.peakGroupKb, report.maxRssKb),
        });
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        report: null,
        failure: `Failed to spawn process: ${err.message}`,
        supervisor: null,
        memoryKb: 0,
      });
    });
  });
  return { proc, finished };
}

export async function measuredResult(
  measured: MeasuredProcess,
  timeoutMs: number,
  captured: { stdout: string; stderr: string; outputLimitExceeded: boolean },
): Promise<RunProcessResult> {
  const { report, failure, supervisor, memoryKb } = await measured.finished;
  if (supervisor) {
    return {
      stdout: captured.stdout,
      stderr:
        supervisor === "killed"
          ? `The program terminated its execution supervisor.\n${captured.stderr}`
          : captured.stderr,
      exitCode: -1,
      timeMs: 0,
      memoryKb,
      timedOut: supervisor === "timed-out",
      signal: null,
      spawnError: false,
      outputLimitExceeded: captured.outputLimitExceeded,
    };
  }
  if (!report) return spawnFailure(failure ?? "Execution helper failed.", memoryKb);
  const timeMs = Math.round(report.cpuUs / 1000);
  const signal =
    report.signal === undefined
      ? null
      : (signalNames.get(report.signal) ?? `SIG${String(report.signal)}`);
  return {
    stdout: captured.stdout,
    stderr: captured.outputLimitExceeded
      ? `Output limit exceeded.\n${captured.stderr}`
      : captured.stderr,
    exitCode: report.exitCode ?? -1,
    timeMs,
    memoryKb,
    timedOut: report.killed === "wall" || signal === "SIGXCPU" || timeMs > timeoutMs,
    signal,
    spawnError: false,
    outputLimitExceeded: captured.outputLimitExceeded,
  };
}

export async function runProcess(
  command: string[],
  options: MeasuredOptions & { stdin?: string },
): Promise<RunProcessResult> {
  const [cmd, ...args] = command;
  if (!cmd) return spawnFailure("Empty run command.");

  const measured = spawnMeasured([cmd, ...args], {
    ...options,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
  });
  const { proc } = measured;
  const stdoutBuf = createBoundedBuffer(MAX_EXECUTION_OUTPUT_BYTES);
  const stderrBuf = createBoundedBuffer(MAX_EXECUTION_OUTPUT_BYTES);
  let outputBytes = 0;
  let outputLimitExceeded = false;
  function captureOutput(buffer: ReturnType<typeof createBoundedBuffer>, chunk: Buffer) {
    if (outputLimitExceeded) return;
    const remaining = MAX_EXECUTION_OUTPUT_BYTES - outputBytes;
    buffer.push(chunk.subarray(0, remaining));
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_EXECUTION_OUTPUT_BYTES) {
      outputLimitExceeded = true;
      proc.kill("SIGTERM");
    }
  }
  proc.stdout?.on("data", (chunk: Buffer) => {
    captureOutput(stdoutBuf, chunk);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    captureOutput(stderrBuf, chunk);
  });
  if (options.stdin !== undefined) {
    proc.stdin?.on("error", ignoreStreamError);
    proc.stdin?.write(options.stdin);
    proc.stdin?.end();
  }
  await measured.finished;
  return measuredResult(measured, options.timeoutMs, {
    stdout: stdoutBuf.toString(),
    stderr: stderrBuf.toString(),
    outputLimitExceeded,
  });
}

export function classifySolutionVerdict(
  result: RunProcessResult,
  testcaseIndex: number,
): SandboxTestcaseResult | null {
  const base = {
    index: testcaseIndex,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    ...(result.memoryKb > 0 ? { memoryKb: result.memoryKb } : {}),
  };

  if (result.spawnError) return { ...base, verdict: "SE" };
  if (result.outputLimitExceeded) return { ...base, verdict: "RE" };
  if (result.timedOut) return { ...base, verdict: "TLE" };
  if (result.signal === "SIGKILL") return { ...base, verdict: "MLE" };
  if (result.exitCode !== 0) return { ...base, verdict: "RE" };
  return null;
}
