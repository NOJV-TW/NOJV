import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from "node:child_process";

import { workspaceRunResultSchema, type WorkspaceRunResult } from "@nojv/domain";

interface SandboxStream {
  on(event: string, handler: (chunk: string) => void): void;
  setEncoding?(encoding: BufferEncoding): void;
}

interface SandboxStdin {
  end(): void;
  write?(chunk: string): void;
}

interface SandboxChildProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "close", handler: (code: number | null) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  on(event: string, handler: (value: unknown) => void): void;
  stderr: SandboxStream;
  stdin: SandboxStdin;
  stdout: SandboxStream;
}

export type SpawnImplementation = (
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio & { stdio: "pipe" }
) => SandboxChildProcess;

export interface DockerSandboxInvocationInput {
  argv: [string, ...string[]];
  containerName: string;
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
  workspaceRoot: string;
}

export interface DockerSandboxRunInput extends DockerSandboxInvocationInput {
  stdin?: string;
  timeoutMs: number;
}

interface DockerSandboxOptions {
  spawnImplementation?: SpawnImplementation;
}

const sandboxTmpfsSpec = "/tmp:rw,nosuid,nodev,size=64m";
const defaultSpawnImplementation: SpawnImplementation = (
  binary,
  args,
  options
): ChildProcessWithoutNullStreams => spawn(binary, args, options);

export function buildDockerSandboxInvocation(input: DockerSandboxInvocationInput) {
  return {
    args: [
      "run",
      "--rm",
      "--name",
      input.containerName,
      "--network",
      "none",
      "--cpus",
      input.cpuLimit,
      "--memory",
      `${String(input.memoryMb)}m`,
      "--pids-limit",
      String(input.pidsLimit),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--tmpfs",
      sandboxTmpfsSpec,
      "--workdir",
      "/workspace",
      "--volume",
      `${input.workspaceRoot}:/workspace`,
      "--env",
      "HOME=/tmp",
      input.image,
      ...input.argv
    ],
    binary: "docker"
  };
}

async function forceRemoveContainer(
  containerName: string,
  spawnImplementation: SpawnImplementation
) {
  await new Promise<void>((resolve) => {
    const child = spawnImplementation("docker", ["rm", "-f", containerName], {
      env: process.env,
      stdio: "pipe"
    });

    child.on("error", () => {
      resolve();
    });

    child.on("close", () => {
      resolve();
    });

    child.stdin.end();
  });
}

export async function runDockerSandboxCommand(
  input: DockerSandboxRunInput,
  options: DockerSandboxOptions = {}
): Promise<WorkspaceRunResult> {
  const spawnImplementation = options.spawnImplementation ?? defaultSpawnImplementation;
  const invocation = buildDockerSandboxInvocation(input);
  const startedAt = Date.now();

  return await new Promise<WorkspaceRunResult>((resolve) => {
    const child = spawnImplementation(invocation.binary, invocation.args, {
      env: process.env,
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const settle = (result: WorkspaceRunResult) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      void forceRemoveContainer(input.containerName, spawnImplementation);
      child.kill("SIGKILL");
    }, input.timeoutMs);

    child.stdout.setEncoding?.("utf8");
    child.stderr.setEncoding?.("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: unknown) => {
      clearTimeout(timer);
      settle(
        workspaceRunResultSchema.parse({
          durationMs: Date.now() - startedAt,
          exitCode: null,
          stderr: error instanceof Error ? error.message : "Docker sandbox failed to start.",
          status: "failed",
          stdout
        })
      );
    });

    child.on("close", (exitCode: number | null) => {
      clearTimeout(timer);
      settle(
        workspaceRunResultSchema.parse({
          durationMs: Date.now() - startedAt,
          exitCode: timedOut ? null : exitCode,
          stderr: timedOut ? `${stderr}\nExecution timed out.`.trim() : stderr,
          status: timedOut ? "timed_out" : exitCode === 0 ? "succeeded" : "failed",
          stdout
        })
      );
    });

    if (input.stdin) {
      child.stdin.write?.(input.stdin);
    }

    child.stdin.end();
  });
}
