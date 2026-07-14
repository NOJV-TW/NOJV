import { spawn } from "node:child_process";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { executionAbortReason } from "./execution-abort";

const DOCKER_CLEANUP_TIMEOUT_MS = 5_000;
const DOCKER_INSPECT_TIMEOUT_MS = 5_000;
const DOCKER_LOG_TIMEOUT_MS = 10_000;
const DOCKER_COMMAND_OUTPUT_BYTES = 64 * 1024;

export type DockerCommandFailure = "spawn" | "timeout" | "exit";

export class DockerCommandError extends Error {
  constructor(
    readonly failure: DockerCommandFailure,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(
      failure === "timeout"
        ? `Docker command timed out: docker ${args.join(" ")}`
        : failure === "spawn"
          ? `Docker command could not start: ${stderr}`
          : `Docker command failed (${String(exitCode)}): ${stderr || "no diagnostic output"}`,
    );
    this.name = "DockerCommandError";
  }
}

export interface DockerCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  ignoreMissingResource?: boolean;
}

export interface DockerCommandResult {
  stdout: string;
  stderr: string;
}

function failureMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.cause === undefined
      ? reason.message
      : `${reason.message} Caused by: ${failureMessage(reason.cause)}`;
  }
  if (typeof reason === "string") return reason;
  try {
    const serialized: unknown = JSON.stringify(reason);
    return typeof serialized === "string" ? serialized : String(reason);
  } catch {
    return String(reason);
  }
}

export function attachDockerCleanupFailure(
  primaryFailure: Error,
  label: string,
  cleanupFailure: unknown,
): Error {
  Object.defineProperty(primaryFailure, "message", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: `${primaryFailure.message} ${label} cleanup failed: ${failureMessage(cleanupFailure)}`,
  });
  return primaryFailure;
}

export async function cleanupDockerResources(
  label: string,
  resources: { name: string; remove: () => Promise<void> }[],
): Promise<void> {
  const failures: string[] = [];
  for (const resource of resources) {
    try {
      await resource.remove();
    } catch (error) {
      failures.push(`${resource.name}: ${failureMessage(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(`${label} cleanup failed: ${failures.join(" | ")}`);
}

function isMissingResourceDiagnostic(stderr: string): boolean {
  return /(?:no such (?:container|network)|(?:container|network) .+ not found)/i.test(stderr);
}

export function runDockerCommand(
  args: string[],
  options: DockerCommandOptions = {},
): Promise<DockerCommandResult> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
    const stdout = createBoundedStringBuffer(DOCKER_COMMAND_OUTPUT_BYTES);
    const stderr = createBoundedStringBuffer(DOCKER_COMMAND_OUTPUT_BYTES);
    let settled = false;
    let terminalError: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error("Docker command failed."));
      } else resolve({ stdout: stdout.toString().trim(), stderr: stderr.toString().trim() });
    };
    const terminate = (error: unknown) => {
      if (terminalError !== undefined) return;
      terminalError = error;
      child.kill("SIGKILL");
      killTimer = setTimeout(() => settle(error), 1_000);
    };
    const abort = () => {
      if (options.signal) terminate(executionAbortReason(options.signal));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => terminate(new DockerCommandError("timeout", args, stderr.toString(), null)),
      options.timeoutMs ?? DOCKER_INSPECT_TIMEOUT_MS,
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", (error: Error) => {
      settle(terminalError ?? new DockerCommandError("spawn", args, error.message, null));
    });
    child.on("close", (code: number | null) => {
      if (terminalError !== undefined) {
        settle(terminalError);
        return;
      }
      const diagnostic = stderr.toString().trim();
      if (
        code === 0 ||
        (options.ignoreMissingResource && isMissingResourceDiagnostic(diagnostic))
      ) {
        settle();
        return;
      }
      settle(new DockerCommandError("exit", args, diagnostic, code));
    });
    child.stdin.end();
  });
}

export function collectContainerLogs(
  containerName: string,
  signal: AbortSignal,
): Promise<string> {
  return runDockerCommand(["logs", containerName], {
    signal,
    timeoutMs: DOCKER_LOG_TIMEOUT_MS,
  }).then(({ stdout, stderr }) => [stdout, stderr].filter(Boolean).join("\n"));
}

export function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

export function runDocker(
  args: string[],
  signal: AbortSignal,
  options: { timeoutMs?: number; ignoreMissingResource?: boolean } = {},
): Promise<void> {
  return runDockerCommand(args, {
    signal,
    timeoutMs: options.timeoutMs ?? DOCKER_INSPECT_TIMEOUT_MS,
    ...(options.ignoreMissingResource ? { ignoreMissingResource: true } : {}),
  }).then(() => undefined);
}

export interface DockerRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  sizeExceeded: boolean;
  spawnError: string | null;
}

export interface DockerRunOptions {
  args: string[];
  containerName: string;
  outerTimeoutMs: number;
  signal: AbortSignal;
  watch?: { dir: string; intervalMs: number; exceeds: (dir: string) => Promise<boolean> };
}

export async function spawnDockerContainer(opts: DockerRunOptions): Promise<DockerRunResult> {
  opts.signal.throwIfAborted();

  return new Promise<DockerRunResult>((resolve, reject) => {
    const child = spawn("docker", opts.args, { env: process.env, stdio: "pipe" });
    const stdoutBuf = createBoundedStringBuffer();
    const stderrBuf = createBoundedStringBuffer();
    let timedOut = false;
    let sizeExceeded = false;
    let settled = false;
    let checkInFlight = false;
    let termination: Promise<void> | null = null;
    let terminationResult: (() => DockerRunResult) | null = null;
    let terminationFailure: Error | null = null;
    let abortReason: Error | null = null;

    const settle = (result: DockerRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      opts.signal.removeEventListener("abort", abort);
      resolve(result);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      opts.signal.removeEventListener("abort", abort);
      reject(error instanceof Error ? error : new Error("Docker container execution failed."));
    };

    const currentResult = (exitCode: number | null): DockerRunResult => ({
      exitCode,
      stdout: stdoutBuf.toString(),
      stderr: stderrBuf.toString(),
      timedOut,
      sizeExceeded,
      spawnError: null,
    });

    const terminate = (): void => {
      if (termination) return;
      child.kill("SIGKILL");
      termination = forceRemoveContainer(opts.containerName);
      void termination.then(
        () => {
          if (abortReason || opts.signal.aborted) {
            fail(abortReason ?? executionAbortReason(opts.signal));
            return;
          }
          if (terminationFailure) {
            fail(terminationFailure);
            return;
          }
          if (terminationResult) settle(terminationResult());
        },
        (cleanupError: unknown) => {
          if (abortReason || opts.signal.aborted) {
            fail(
              attachDockerCleanupFailure(
                abortReason ?? executionAbortReason(opts.signal),
                "Docker container",
                cleanupError,
              ),
            );
            return;
          }
          if (terminationFailure) {
            fail(
              attachDockerCleanupFailure(terminationFailure, "Docker container", cleanupError),
            );
            return;
          }
          fail(cleanupError);
        },
      );
    };

    const abort = () => {
      abortReason ??= executionAbortReason(opts.signal);
      terminate();
    };
    opts.signal.addEventListener("abort", abort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      terminationResult = () => currentResult(null);
      terminate();
    }, opts.outerTimeoutMs);

    const watch = opts.watch;
    const poll = watch
      ? setInterval(() => {
          if (sizeExceeded || checkInFlight) return;
          checkInFlight = true;
          void watch
            .exceeds(watch.dir)
            .then(
              (over) => {
                if (over) {
                  sizeExceeded = true;
                  terminationResult = () => currentResult(null);
                  terminate();
                }
              },
              (error: unknown) => {
                terminationFailure =
                  error instanceof Error
                    ? error
                    : new Error("Docker workspace size check failed.", { cause: error });
                terminate();
              },
            )
            .finally(() => {
              checkInFlight = false;
            });
        }, watch.intervalMs)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdoutBuf.push(chunk));
    child.stderr.on("data", (chunk: string) => stderrBuf.push(chunk));

    child.on("error", (err: Error) => {
      if (opts.signal.aborted) {
        abort();
        return;
      }
      if (termination) return;
      settle({
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        sizeExceeded: false,
        spawnError: err.message,
      });
    });

    child.on("close", (code: number | null) => {
      if (opts.signal.aborted) {
        abort();
        return;
      }
      if (!termination) settle(currentResult(code));
    });

    child.stdin.end();
  });
}

export function forceRemoveContainer(containerName: string): Promise<void> {
  return runDockerCommand(["rm", "-f", containerName], {
    timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS,
    ignoreMissingResource: true,
  }).then(() => undefined);
}
