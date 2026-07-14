import { spawn, spawnSync } from "node:child_process";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { executionAbortReason } from "./execution-abort";

const DOCKER_CLEANUP_TIMEOUT_MS = 5_000;

export function collectContainerLogs(
  containerName: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const buffer = createBoundedStringBuffer();
    let settled = false;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error("Docker log collection failed."));
        return;
      }
      resolve(buffer.toString().trim());
    };

    const child = spawn("docker", ["logs", containerName], { env: process.env, stdio: "pipe" });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      buffer.push(chunk);
    });
    const abort = () => {
      child.kill("SIGKILL");
      settle(executionAbortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => settle());
    child.on("close", () => settle());
    child.stdin.end();
  });
}

export function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

export function runDocker(args: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
    let stderr = "";
    let settled = false;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (abortTimer) clearTimeout(abortTimer);
      signal.removeEventListener("abort", abort);
      if (error !== undefined)
        reject(error instanceof Error ? error : new Error("Docker command failed."));
      else resolve();
    };
    const abort = () => {
      child.kill("SIGKILL");
      abortTimer = setTimeout(
        () => settle(executionAbortReason(signal)),
        DOCKER_CLEANUP_TIMEOUT_MS,
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err: Error) => {
      settle(signal.aborted ? executionAbortReason(signal) : err);
    });
    child.on("close", (code: number | null) => {
      if (signal.aborted) {
        settle(executionAbortReason(signal));
        return;
      }
      if (code === 0) {
        settle();
        return;
      }
      settle(new Error(`docker ${args.join(" ")} failed (${String(code)}): ${stderr.trim()}`));
    });
    child.stdin.end();
  });
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
  await forceRemoveContainer(opts.containerName);
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

    const settle = (result: DockerRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      opts.signal.removeEventListener("abort", abort);
      resolve(result);
    };

    const currentResult = (exitCode: number | null): DockerRunResult => ({
      exitCode,
      stdout: stdoutBuf.toString(),
      stderr: stderrBuf.toString(),
      timedOut,
      sizeExceeded,
      spawnError: null,
    });

    const terminate = (): Promise<void> => {
      if (termination) return termination;
      child.kill("SIGKILL");
      termination = forceRemoveContainer(opts.containerName);
      return termination;
    };

    const abort = () => {
      void terminate().then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (poll) clearInterval(poll);
        opts.signal.removeEventListener("abort", abort);
        reject(executionAbortReason(opts.signal));
      });
    };
    opts.signal.addEventListener("abort", abort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      void terminate().then(() => settle(currentResult(null)));
    }, opts.outerTimeoutMs);

    const watch = opts.watch;
    const poll = watch
      ? setInterval(() => {
          if (sizeExceeded || checkInFlight) return;
          checkInFlight = true;
          void watch
            .exceeds(watch.dir)
            .then((over) => {
              if (over) {
                sizeExceeded = true;
                void terminate().then(() => settle(currentResult(null)));
              }
            })
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
      void (termination ?? Promise.resolve()).then(() => {
        if (opts.signal.aborted) {
          abort();
          return;
        }
        settle(currentResult(code));
      });
    });

    child.stdin.end();
  });
}

export function buildInspectNetworkIpArgs(
  containerName: string,
  networkName: string,
): string[] {
  return [
    "inspect",
    "-f",
    `{{(index .NetworkSettings.Networks ${JSON.stringify(networkName)}).IPAddress}}`,
    containerName,
  ];
}

export function inspectContainerNetworkIp(
  containerName: string,
  networkName: string,
): string | null {
  const result = spawnSync("docker", buildInspectNetworkIpArgs(containerName, networkName), {
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const ip = result.stdout.trim();
  return ip.length > 0 ? ip : null;
}

export function forceRemoveContainer(containerName: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["rm", "-f", containerName], {
      env: process.env,
      stdio: "pipe",
    });
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle();
    }, DOCKER_CLEANUP_TIMEOUT_MS);

    child.stdin.end();
    child.on("error", settle);
    child.on("close", settle);
  });
}
