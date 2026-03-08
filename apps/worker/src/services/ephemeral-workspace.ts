import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  workspaceRunRequestSchema,
  workspaceRunResultSchema,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";

import { runDockerSandboxCommand, type SpawnImplementation } from "./docker-sandbox";

const defaultSandboxRuntime = {
  cpuLimit: resolveTrimmedString(process.env.SANDBOX_CPU_LIMIT, "1"),
  image: resolveTrimmedString(process.env.SANDBOX_IMAGE, "nojv-sandbox:local"),
  memoryMb: resolvePositiveInt(process.env.SANDBOX_MEMORY_MB, 256),
  pidsLimit: resolvePositiveInt(process.env.SANDBOX_PIDS_LIMIT, 64)
} as const;
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
    throw new Error("workspaceSessionId is required for isolated execution.");
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

function resolvePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveTrimmedString(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export interface ExecuteEphemeralWorkspaceRunOptions {
  sandboxCpuLimit?: string;
  sandboxImage?: string;
  sandboxMemoryMb?: number;
  sandboxPidsLimit?: number;
  spawnImplementation?: SpawnImplementation;
}

export async function executeEphemeralWorkspaceRun(
  payload: WorkspaceRunRequest,
  options: ExecuteEphemeralWorkspaceRunOptions = {}
): Promise<WorkspaceRunResult> {
  const request = workspaceRunRequestSchema.parse(payload);
  const workspaceSessionId = resolveWorkspaceSessionId(request);

  try {
    validateCommandPolicy(request);
  } catch (error) {
    return blockedResult(error instanceof Error ? error.message : "Command policy rejected.");
  }

  const workspaceRoot = await mkdtemp(
    join(tmpdir(), `nojv-${sanitizeIdentifier(workspaceSessionId)}-`)
  );

  try {
    await chmod(workspaceRoot, 0o777);
    await materializeFiles(workspaceRoot, request);

    return await runDockerSandboxCommand(
      {
        ...(request.stdin ? { stdin: request.stdin } : {}),
        argv: tokenizeCommand(request.command),
        containerName: `nojv-sandbox-${sanitizeIdentifier(workspaceSessionId).slice(0, 40)}`,
        cpuLimit: options.sandboxCpuLimit ?? defaultSandboxRuntime.cpuLimit,
        image: options.sandboxImage ?? defaultSandboxRuntime.image,
        memoryMb: options.sandboxMemoryMb ?? defaultSandboxRuntime.memoryMb,
        pidsLimit: options.sandboxPidsLimit ?? defaultSandboxRuntime.pidsLimit,
        timeoutMs: request.timeoutMs,
        workspaceRoot
      },
      {
        ...(options.spawnImplementation
          ? { spawnImplementation: options.spawnImplementation }
          : {})
      }
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}
