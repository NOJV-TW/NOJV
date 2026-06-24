import { spawn, spawnSync } from "node:child_process";

import { createBoundedStringBuffer } from "./bounded-buffer";

export function collectContainerLogs(containerName: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const buffer = createBoundedStringBuffer();
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
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
    child.on("error", settle);
    child.on("close", settle);
    child.stdin.end();
  });
}

export function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

export function runDocker(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err: Error) => {
      reject(err);
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker ${args.join(" ")} failed (${String(code)}): ${stderr.trim()}`));
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
  watch?: { dir: string; intervalMs: number; exceeds: (dir: string) => Promise<boolean> };
}

export function spawnDockerContainer(opts: DockerRunOptions): Promise<DockerRunResult> {
  forceRemoveContainerSync(opts.containerName);

  return new Promise<DockerRunResult>((resolve) => {
    const child = spawn("docker", opts.args, { env: process.env, stdio: "pipe" });
    const stdoutBuf = createBoundedStringBuffer();
    const stderrBuf = createBoundedStringBuffer();
    let timedOut = false;
    let sizeExceeded = false;
    let settled = false;
    let checkInFlight = false;

    const settle = (result: DockerRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      forceRemoveContainer(opts.containerName);
      child.kill("SIGKILL");
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
                forceRemoveContainer(opts.containerName);
                child.kill("SIGKILL");
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
      settle({
        exitCode: code,
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        timedOut,
        sizeExceeded,
        spawnError: null,
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

export function forceRemoveContainer(containerName: string): void {
  const child = spawn("docker", ["rm", "-f", containerName], {
    env: process.env,
    stdio: "pipe",
  });

  child.stdin.end();
  child.on("error", () => undefined);
}

export function forceRemoveContainerSync(containerName: string): void {
  spawnSync("docker", ["rm", "-f", containerName], { env: process.env, stdio: "ignore" });
}
