import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  advancedResultSchema,
  type SandboxAdvancedRequest,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";
import { createStorageClient, downloadAdvancedImageTarball } from "@nojv/storage";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { sandboxSystemError } from "./sandbox-plan";
import { resolveSourceFiles } from "./source-files.js";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";

export interface AdvancedModeConfig {
  cpuLimit: string;
  pidsLimit: number;
}

export const ADVANCED_WORKSPACE_MAX_BYTES = 1024 * 1024 * 1024;
const WORKSPACE_POLL_INTERVAL_MS = 2_000;
const RUN_USER = "10001:10001";

export type RunState = "exited" | "timed_out" | "oom_killed";

export interface RunStatus {
  state: RunState;
  exitCode: number | null;
}

export interface ContainerOutcome {
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  sizeExceeded: boolean;
  spawnError: boolean;
}

export function deriveRunStatus(outcome: ContainerOutcome): RunStatus {
  if (outcome.timedOut) {
    return { state: "timed_out", exitCode: outcome.exitCode };
  }
  if (outcome.exitCode === 137) {
    return { state: "oom_killed", exitCode: outcome.exitCode };
  }
  return { state: "exited", exitCode: outcome.exitCode };
}

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await dirSizeBytes(full);
      } else if (entry.isFile()) {
        total += (await stat(full)).size;
      }
    } catch {
      continue;
    }
  }
  return total;
}

export interface AdvancedDockerArgsParams {
  containerName: string;
  networkArgs: string[];
  workspaceDir: string;
  cpuLimit: string;
  memoryMb: number;
  pidsLimit: number;
  imageRef: string;
  submissionId: string;
  language: string;
  user?: string | null;
}

export function buildAdvancedDockerArgs(params: AdvancedDockerArgsParams): string[] {
  return [
    "run",
    "--rm",
    "--name",
    params.containerName,
    ...params.networkArgs,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...(params.user ? ["--user", params.user] : []),
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "-v",
    `${params.workspaceDir}:/workspace`,
    "--cpus",
    params.cpuLimit,
    "--memory",
    `${String(params.memoryMb)}m`,
    "--memory-swap",
    `${String(params.memoryMb)}m`,
    "--pids-limit",
    String(params.pidsLimit),
    "--env",
    `SUBMISSION_ID=${params.submissionId}`,
    "--env",
    `LANGUAGE=${params.language}`,
    "--workdir",
    "/workspace",
    params.imageRef,
  ];
}

export interface RunWorkspaceInput {
  submissionId: string;
  language: string;
  totalTimeMs: number;
  memoryMb: number;
}

export async function prepareRunWorkspace(
  runDir: string,
  request: SandboxRequest,
  input: RunWorkspaceInput,
): Promise<void> {
  const submissionDir = join(runDir, "submission");
  const outputDir = join(runDir, "output");

  await mkdir(runDir, { mode: 0o777, recursive: true });
  await mkdir(submissionDir, { mode: 0o777, recursive: true });
  await mkdir(outputDir, { mode: 0o777, recursive: true });

  const resolved = resolveSourceFiles(request, { requireSourceCode: true });
  const fileWrites: Promise<void>[] = [];

  for (const sf of resolved) {
    const dest = join(submissionDir, sf.path);
    fileWrites.push(
      (async () => {
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, sf.content, "utf8");
      })(),
    );
  }

  const meta = {
    submissionId: input.submissionId,
    language: input.language,
    submissionFiles: resolved.map((f) => f.path),
    resourceLimits: {
      totalTimeMs: input.totalTimeMs,
      memoryMb: input.memoryMb,
    },
  };
  fileWrites.push(writeFile(join(runDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8"));

  await Promise.all(fileWrites);
  await chmod(runDir, 0o777);
}

export async function prepareGradeWorkspace(
  gradeDir: string,
  runOutputDir: string,
  input: { submissionId: string; language: string; runStatus: RunStatus },
): Promise<void> {
  const gradeRunOutputDir = join(gradeDir, "run-output");
  const outputDir = join(gradeDir, "output");

  await mkdir(gradeDir, { mode: 0o777, recursive: true });
  await mkdir(gradeRunOutputDir, { mode: 0o777, recursive: true });
  await mkdir(outputDir, { mode: 0o777, recursive: true });

  await cp(runOutputDir, gradeRunOutputDir, { recursive: true });

  const meta = {
    submissionId: input.submissionId,
    language: input.language,
    runStatus: input.runStatus,
  };
  await writeFile(join(gradeDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  await chmod(gradeDir, 0o777);
}

interface SpawnContainerParams {
  args: string[];
  containerName: string;
  outerTimeoutMs: number;
  watchDir?: string;
}

function spawnContainer(params: SpawnContainerParams): Promise<ContainerOutcome> {
  forceRemoveContainerSync(params.containerName);

  return new Promise((resolve) => {
    const child = spawn("docker", params.args, { env: process.env, stdio: "pipe" });
    const stderrBuf = createBoundedStringBuffer();
    let timedOut = false;
    let sizeExceeded = false;
    let settled = false;
    let sizeCheckInFlight = false;

    const settle = (value: ContainerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(sizePoll);
      resolve(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      forceRemoveContainer(params.containerName);
      child.kill("SIGKILL");
    }, params.outerTimeoutMs);

    const watchDir = params.watchDir;
    const sizePoll = watchDir
      ? setInterval(() => {
          if (sizeExceeded || sizeCheckInFlight) return;
          sizeCheckInFlight = true;
          void dirSizeBytes(watchDir)
            .then((bytes) => {
              if (bytes > ADVANCED_WORKSPACE_MAX_BYTES) {
                sizeExceeded = true;
                forceRemoveContainer(params.containerName);
                child.kill("SIGKILL");
              }
            })
            .finally(() => {
              sizeCheckInFlight = false;
            });
        }, WORKSPACE_POLL_INTERVAL_MS)
      : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuf.push(chunk);
    });

    child.on("error", (err: Error) => {
      settle({
        exitCode: null,
        stderr: `spawn failed: ${err.message}`,
        timedOut: false,
        sizeExceeded: false,
        spawnError: true,
      });
    });

    child.on("close", (code: number | null) => {
      settle({
        exitCode: code,
        stderr: stderrBuf.toString(),
        timedOut,
        sizeExceeded,
        spawnError: false,
      });
    });

    child.stdin.end();
  });
}

export class AdvancedModeExecutor {
  private readonly loadedTarballs = new Map<string, string>();

  async run(
    tempDir: string,
    request: SandboxRequest,
    config: AdvancedModeConfig,
  ): Promise<SandboxResult> {
    const advanced = request.advanced;
    if (!advanced) {
      return sandboxSystemError("advanced-mode dispatch called without payload");
    }

    let runImageRef: string;
    let gradeImageRef: string;
    try {
      runImageRef = await this.resolveImageRef(advanced.run);
      gradeImageRef = await this.resolveImageRef(advanced.grade);
    } catch (err) {
      return advancedFallbackResult(
        request,
        `Failed to load advanced image tarball: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const runDir = join(tempDir, "run");
    const gradeDir = join(tempDir, "grade");
    const runOutputDir = join(runDir, "output");

    await prepareRunWorkspace(runDir, request, {
      submissionId: request.submissionId,
      language: request.language,
      totalTimeMs: advanced.totalTimeMs,
      memoryMb: advanced.memoryMb,
    });

    const runOutcome = await this.runPhase(request, advanced, config, runImageRef, runDir);

    if (runOutcome.spawnError) {
      return advancedFallbackResult(
        request,
        `Advanced run container failed to start: ${runOutcome.stderr}`.trim(),
      );
    }
    if (runOutcome.sizeExceeded) {
      return advancedFallbackResult(
        request,
        "Advanced judge image exceeded the output size limit.",
      );
    }

    const runStatus = deriveRunStatus(runOutcome);

    await prepareGradeWorkspace(gradeDir, runOutputDir, {
      submissionId: request.submissionId,
      language: request.language,
      runStatus,
    });

    const gradeOutcome = await this.gradePhase(
      request,
      advanced,
      config,
      gradeImageRef,
      gradeDir,
    );

    if (gradeOutcome.spawnError) {
      return advancedFallbackResult(
        request,
        `Advanced grade container failed to start: ${gradeOutcome.stderr}`.trim(),
      );
    }
    if (gradeOutcome.timedOut) {
      return advancedFallbackResult(request, "Advanced grade image timed out.");
    }

    let resultJson: unknown;
    try {
      const raw = await readFile(join(gradeDir, "output", "result.json"), "utf8");
      resultJson = JSON.parse(raw);
    } catch {
      return advancedFallbackResult(
        request,
        `Advanced grade image did not write result.json. exit=${String(gradeOutcome.exitCode)}\n${gradeOutcome.stderr}`.trim(),
      );
    }

    const parsed = advancedResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      return advancedFallbackResult(
        request,
        `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
    }

    return mapAdvancedResult(request, parsed.data);
  }

  private runPhase(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    runDir: string,
  ): Promise<ContainerOutcome> {
    const containerName = `nojv-advanced-run-${sanitizeId(request.submissionId).slice(0, 36)}`;
    const args = buildAdvancedDockerArgs({
      containerName,
      networkArgs: ["--network", "none"],
      workspaceDir: runDir,
      cpuLimit: config.cpuLimit,
      memoryMb: advanced.memoryMb,
      pidsLimit: config.pidsLimit,
      imageRef,
      submissionId: request.submissionId,
      language: request.language,
      user: RUN_USER,
    });
    return spawnContainer({
      args,
      containerName,
      outerTimeoutMs: advanced.totalTimeMs + 30_000,
      watchDir: runDir,
    });
  }

  private gradePhase(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    gradeDir: string,
  ): Promise<ContainerOutcome> {
    const containerName = `nojv-advanced-grade-${sanitizeId(request.submissionId).slice(0, 34)}`;
    const args = buildAdvancedDockerArgs({
      containerName,
      networkArgs: [],
      workspaceDir: gradeDir,
      cpuLimit: config.cpuLimit,
      memoryMb: advanced.memoryMb,
      pidsLimit: config.pidsLimit,
      imageRef,
      submissionId: request.submissionId,
      language: request.language,
      user: null,
    });
    return spawnContainer({
      args,
      containerName,
      outerTimeoutMs: advanced.totalTimeMs + 30_000,
    });
  }

  private async resolveImageRef(image: SandboxAdvancedRequest["run"]): Promise<string> {
    if (image.imageSource === "tarball") {
      return this.ensureTarballLoaded(image.imageRef);
    }
    return image.imageRef;
  }

  private async ensureTarballLoaded(storageKey: string): Promise<string> {
    const cached = this.loadedTarballs.get(storageKey);
    if (cached) return cached;

    const storage = createStorageClient();
    const buffer = await downloadAdvancedImageTarball(storage, storageKey);

    const ref = await new Promise<string>((resolve, reject) => {
      const child = spawn("docker", ["load", "-q"], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdoutBuf = createBoundedStringBuffer();
      const stderrBuf = createBoundedStringBuffer();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (c: string) => {
        stdoutBuf.push(c);
      });
      child.stderr.on("data", (c: string) => {
        stderrBuf.push(c);
      });
      child.on("error", (err: Error) => reject(err));
      child.on("close", (code: number | null) => {
        const stdout = stdoutBuf.toString();
        const stderr = stderrBuf.toString();
        if (code !== 0) {
          reject(new Error(`docker load returned ${String(code)}: ${stderr.trim()}`));
          return;
        }
        const match = /(?:Loaded image:\s*|^)(\S+)\s*$/m.exec(stdout.trim());
        const ref = match?.[1];
        if (!ref) {
          reject(new Error(`Could not parse docker load output: ${stdout}`));
          return;
        }
        resolve(ref);
      });
      child.stdin.write(buffer);
      child.stdin.end();
    });

    this.loadedTarballs.set(storageKey, ref);
    return ref;
  }
}
