import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  workspaceRunRequestSchema,
  workspaceRunResultSchema,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";

const unsupportedShellSyntax = /[;&|><`$()[\]{}]/;
const commandAllowlist = {
  assignment: new Set([
    "bash",
    "g++",
    "gcc",
    "java",
    "javac",
    "make",
    "node",
    "npm",
    "pnpm",
    "python",
    "python3",
    "rustc",
    "sh"
  ]),
  contest: new Set([
    "g++",
    "gcc",
    "java",
    "javac",
    "make",
    "node",
    "python",
    "python3",
    "rustc"
  ]),
  exam: new Set(["g++", "gcc", "java", "javac", "make", "node", "python", "python3", "rustc"]),
  practice: new Set([
    "bash",
    "g++",
    "gcc",
    "java",
    "javac",
    "make",
    "node",
    "npm",
    "pnpm",
    "python",
    "python3",
    "rustc",
    "sh"
  ])
} as const;

interface HostedSandboxChildProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: string, handler: (value: unknown) => void): void;
  stderr: {
    on(event: string, handler: (chunk: string) => void): void;
    setEncoding?(encoding: BufferEncoding): void;
  };
  stdin: {
    end(): void;
    write?(chunk: string): void;
  };
  stdout: {
    on(event: string, handler: (chunk: string) => void): void;
    setEncoding?(encoding: BufferEncoding): void;
  };
}

export type HostedSpawnImplementation = (
  binary: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: "pipe";
  }
) => HostedSandboxChildProcess;

export interface HostedExecutorOptions {
  spawnImplementation?: HostedSpawnImplementation;
}

const defaultSpawnImplementation: HostedSpawnImplementation = (
  binary,
  args,
  options
): ChildProcessWithoutNullStreams => spawn(binary, args, options);

function tokenizeCommand(command: string): [string, ...string[]] {
  if (unsupportedShellSyntax.test(command)) {
    throw new Error("Command policy rejected unsupported shell syntax.");
  }

  const tokens = command.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Command policy rejected an empty command.");
  }

  return tokens as [string, ...string[]];
}

function validateCommandPolicy(request: WorkspaceRunRequest) {
  const [binary] = tokenizeCommand(request.command);
  const allowedCommands = commandAllowlist[request.mode];

  if (!allowedCommands.has(binary)) {
    throw new Error(`Command policy rejected "${binary}" for ${request.mode} mode.`);
  }
}

function resolveWorkspaceSessionId(request: WorkspaceRunRequest) {
  if (!request.workspaceSessionId) {
    throw new Error("workspaceSessionId is required for hosted execution.");
  }

  return request.workspaceSessionId;
}

async function materializeFiles(rootDirectory: string, request: WorkspaceRunRequest) {
  await Promise.all(
    request.files.map(async (file) => {
      const targetPath = join(rootDirectory, file.path);
      const targetDirectory = dirname(targetPath);
      await mkdir(targetDirectory, { mode: 0o777, recursive: true });
      await chmod(targetDirectory, 0o777);
      await writeFile(targetPath, file.content, "utf8");
      await chmod(targetPath, 0o666);
    })
  );
}

function blockedResult(message: string): WorkspaceRunResult {
  return workspaceRunResultSchema.parse({
    durationMs: 0,
    exitCode: null,
    stderr: message,
    status: "blocked",
    stdout: ""
  });
}

function sanitizeIdentifier(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

export async function executeHostedWorkspaceRun(
  payload: WorkspaceRunRequest,
  options: HostedExecutorOptions = {}
): Promise<WorkspaceRunResult> {
  const request = workspaceRunRequestSchema.parse(payload);
  const workspaceSessionId = resolveWorkspaceSessionId(request);
  const spawnImplementation = options.spawnImplementation ?? defaultSpawnImplementation;

  try {
    validateCommandPolicy(request);
  } catch (error) {
    return blockedResult(error instanceof Error ? error.message : "Command policy rejected.");
  }

  const workspaceRoot = await mkdtemp(
    join(tmpdir(), `nojv-hosted-${sanitizeIdentifier(workspaceSessionId)}-`)
  );
  const startedAt = Date.now();

  try {
    await chmod(workspaceRoot, 0o777);
    await materializeFiles(workspaceRoot, request);

    const [binary, ...args] = tokenizeCommand(request.command);

    return await new Promise<WorkspaceRunResult>((resolve) => {
      const child = spawnImplementation(binary, args, {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          HOME: "/tmp"
        },
        stdio: "pipe"
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, request.timeoutMs);

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
        resolve(
          workspaceRunResultSchema.parse({
            durationMs: Date.now() - startedAt,
            exitCode: null,
            stderr: error instanceof Error ? error.message : "Hosted execution failed.",
            status: "failed",
            stdout
          })
        );
      });

      child.on("close", (exitCode: unknown) => {
        clearTimeout(timer);
        resolve(
          workspaceRunResultSchema.parse({
            durationMs: Date.now() - startedAt,
            exitCode: timedOut ? null : typeof exitCode === "number" ? exitCode : null,
            stderr: timedOut ? `${stderr}\nExecution timed out.`.trim() : stderr,
            status: timedOut
              ? "timed_out"
              : typeof exitCode === "number" && exitCode === 0
                ? "succeeded"
                : "failed",
            stdout
          })
        );
      });

      if (request.stdin) {
        child.stdin.write?.(request.stdin);
      }

      child.stdin.end();
    });
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}
