import { spawn } from "node:child_process";
import { constants } from "node:os";
import { Readable } from "node:stream";
import { MAX_EXECUTION_OUTPUT_BYTES, executionWallTimeLimitMs } from "@nojv/core";
import { z } from "zod";
import type { TestcaseResult } from "../types.js";
import { createBoundedBuffer, createMemoryPoller } from "../utils.js";

const ignoreStreamError = () => undefined;

const HELPER_GRACE_MS = 2_000;

const execReportSchema = z.object({
  cpuUs: z.number().int().nonnegative(),
  maxRssKb: z.number().int().nonnegative(),
  killed: z.enum(["none", "wall", "term"]),
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
    const wallBudgetMs = executionWallTimeLimitMs(options.timeoutMs);
    const [cmd, ...args] = command;

    if (!cmd) {
      resolve(spawnFailure("Empty run command."));
      return;
    }

    const useStdin = options.stdin !== undefined;
    const proc = spawn(
      process.env.NOJV_EXEC_PATH ?? "/usr/local/bin/nojv-exec",
      [String(Math.ceil(options.cpuSeconds ?? 0)), String(wallBudgetMs), "--", cmd, ...args],
      {
        stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe", "pipe"],
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      },
    );

    const stdoutBuf = createBoundedBuffer(MAX_EXECUTION_OUTPUT_BYTES);
    const stderrBuf = createBoundedBuffer(MAX_EXECUTION_OUTPUT_BYTES);
    const reportChunks: Buffer[] = [];
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
    const memoryPoller =
      typeof proc.pid === "number" ? createMemoryPoller(proc.pid, false) : null;

    proc.stdout?.on("data", (chunk: Buffer) => {
      captureOutput(stdoutBuf, chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      captureOutput(stderrBuf, chunk);
    });
    const reportStream = proc.stdio[3];
    if (reportStream instanceof Readable) {
      reportStream.on("data", (chunk: Buffer) => reportChunks.push(chunk));
    }

    if (useStdin) {
      proc.stdin?.on("error", ignoreStreamError);
      proc.stdin?.write(options.stdin);
      proc.stdin?.end();
    }

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, wallBudgetMs + HELPER_GRACE_MS);

    proc.on("close", () => {
      clearTimeout(timer);
      const pollerKb = memoryPoller?.stop() ?? 0;
      const report = parseExecReport(Buffer.concat(reportChunks).toString());
      if (!report) {
        resolve(spawnFailure("Execution helper produced no report.", pollerKb));
        return;
      }
      if (report.execErrno !== undefined) {
        resolve(
          spawnFailure(
            `Failed to spawn process: ${errnoNames.get(report.execErrno) ?? String(report.execErrno)}`,
          ),
        );
        return;
      }
      const timeMs = Math.round(report.cpuUs / 1000);
      const signal =
        report.signal === undefined
          ? null
          : (signalNames.get(report.signal) ?? `SIG${String(report.signal)}`);
      const rawStderr = stderrBuf.toString();
      resolve({
        stdout: stdoutBuf.toString(),
        stderr: outputLimitExceeded ? `Output limit exceeded.\n${rawStderr}` : rawStderr,
        exitCode: report.exitCode ?? -1,
        timeMs,
        memoryKb: Math.max(pollerKb, report.maxRssKb),
        timedOut:
          report.killed === "wall" || signal === "SIGXCPU" || timeMs > options.timeoutMs,
        signal,
        spawnError: false,
        outputLimitExceeded,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve(
        spawnFailure(`Failed to spawn process: ${err.message}`, memoryPoller?.stop() ?? 0),
      );
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
  if (result.outputLimitExceeded) return { ...base, verdict: "RE" };
  if (result.timedOut) return { ...base, verdict: "TLE" };
  if (result.signal === "SIGKILL") return { ...base, verdict: "MLE" };
  if (result.exitCode !== 0) return { ...base, verdict: "RE" };
  return null;
}
