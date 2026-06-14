import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  advancedResultSchema,
  type SandboxAdvancedRequest,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";
import { createStorageClient, downloadAdvancedImageTarball } from "@nojv/storage";

import { createLogger } from "../logger.js";
import { createBoundedStringBuffer } from "./bounded-buffer";
import { createSubmissionNetworks, removeSubmissionNetworks } from "./docker-network";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import {
  collectEgressProxyLogs,
  EGRESS_PROXY_PORT,
  startEgressProxy,
  stopEgressProxy,
} from "./egress-proxy";
import {
  ADVANCED_SERVICE_PORT,
  collectServiceLogs,
  SERVICE_HOST_ENV,
  SERVICE_NETWORK_ALIAS,
  startServiceContainer,
  stopServiceContainer,
} from "./service-container";
import { sandboxSystemError } from "./sandbox-plan";
import { resolveSourceFiles } from "./source-files.js";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";

export interface AdvancedModeConfig {
  cpuLimit: string;
  pidsLimit: number;
}

const logger = createLogger("advanced-mode-executor");

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

export interface DirStats {
  bytes: number;
  files: number;
}

export async function dirStats(dir: string): Promise<DirStats> {
  const acc: DirStats = { bytes: 0, files: 0 };
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const nested = await dirStats(full);
        acc.bytes += nested.bytes;
        acc.files += nested.files;
      } else if (entry.isFile()) {
        acc.bytes += (await stat(full)).size;
        acc.files += 1;
      }
    } catch {
      continue;
    }
  }
  return acc;
}

export function exceedsWorkspaceCaps(
  stats: DirStats,
  caps: { maxBytes: number; maxFiles: number },
): boolean {
  return stats.bytes > caps.maxBytes || stats.files > caps.maxFiles;
}

export class SafeCopyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeCopyLimitError";
  }
}

export async function safeCopyTree(
  srcDir: string,
  destDir: string,
  caps: { maxFiles: number; maxBytes: number },
): Promise<void> {
  const counters = { files: 0, bytes: 0 };
  await mkdir(destDir, { recursive: true });
  await copyTreeInto(srcDir, destDir, caps, counters);
}

async function copyTreeInto(
  srcDir: string,
  destDir: string,
  caps: { maxFiles: number; maxBytes: number },
  counters: { files: number; bytes: number },
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    const info = await lstat(srcPath);

    if (info.isSymbolicLink()) {
      continue;
    }
    if (info.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyTreeInto(srcPath, destPath, caps, counters);
      continue;
    }
    if (!info.isFile()) {
      continue;
    }

    counters.files += 1;
    counters.bytes += info.size;
    if (counters.files > caps.maxFiles) {
      throw new SafeCopyLimitError(
        `Advanced run output exceeded the file count limit (${String(caps.maxFiles)}).`,
      );
    }
    if (counters.bytes > caps.maxBytes) {
      throw new SafeCopyLimitError(
        `Advanced run output exceeded the byte limit (${String(caps.maxBytes)}).`,
      );
    }
    await copyFile(srcPath, destPath);
  }
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
  readOnlyMounts?: { hostPath: string; containerPath: string }[];
  extraEnv?: Record<string, string>;
}

export function buildAdvancedDockerArgs(params: AdvancedDockerArgsParams): string[] {
  const readOnlyMountArgs = (params.readOnlyMounts ?? []).flatMap((m) => [
    "-v",
    `${m.hostPath}:${m.containerPath}:ro`,
  ]);
  const extraEnvArgs = Object.entries(params.extraEnv ?? {}).flatMap(([k, v]) => [
    "--env",
    `${k}=${v}`,
  ]);
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
    ...readOnlyMountArgs,
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
    ...extraEnvArgs,
    "--workdir",
    "/workspace",
    params.imageRef,
  ];
}

export function buildProxyEnv(proxyUrl: string): Record<string, string> {
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: "",
    no_proxy: "",
  };
}

export function buildServiceEnv(): Record<string, string> {
  return {
    [SERVICE_HOST_ENV]: `${SERVICE_NETWORK_ALIAS}:${String(ADVANCED_SERVICE_PORT)}`,
  };
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

export const ADVANCED_OUTPUT_MAX_FILES = 100_000;

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

  await safeCopyTree(runOutputDir, gradeRunOutputDir, {
    maxFiles: ADVANCED_OUTPUT_MAX_FILES,
    maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
  });

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
          void dirStats(watchDir)
            .then((stats) => {
              if (
                exceedsWorkspaceCaps(stats, {
                  maxBytes: ADVANCED_WORKSPACE_MAX_BYTES,
                  maxFiles: ADVANCED_OUTPUT_MAX_FILES,
                })
              ) {
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

    try {
      await prepareGradeWorkspace(gradeDir, runOutputDir, {
        submissionId: request.submissionId,
        language: request.language,
        runStatus,
      });
    } catch (err) {
      if (err instanceof SafeCopyLimitError) {
        return advancedFallbackResult(
          request,
          "Advanced run output exceeded the file/size limit.",
        );
      }
      return advancedFallbackResult(
        request,
        `Failed to capture advanced run output: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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

  private async runPhase(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    runDir: string,
  ): Promise<ContainerOutcome> {
    if (advanced.network.mode === "allowlist") {
      return this.runPhaseAllowlist(request, advanced, config, imageRef, runDir);
    }
    if (advanced.network.mode === "service") {
      return this.runPhaseService(request, advanced, config, imageRef, runDir);
    }
    return this.runContainer(request, advanced, config, imageRef, runDir, {
      networkArgs: ["--network", "none"],
    });
  }

  private runContainer(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    runDir: string,
    net: { networkArgs: string[]; extraEnv?: Record<string, string> },
  ): Promise<ContainerOutcome> {
    const containerName = `nojv-advanced-run-${sanitizeId(request.submissionId).slice(0, 36)}`;
    const args = buildAdvancedDockerArgs({
      containerName,
      networkArgs: net.networkArgs,
      workspaceDir: runDir,
      cpuLimit: config.cpuLimit,
      memoryMb: advanced.memoryMb,
      pidsLimit: config.pidsLimit,
      imageRef,
      submissionId: request.submissionId,
      language: request.language,
      user: RUN_USER,
      ...(net.extraEnv ? { extraEnv: net.extraEnv } : {}),
    });
    return spawnContainer({
      args,
      containerName,
      outerTimeoutMs: advanced.totalTimeMs + 30_000,
      watchDir: runDir,
    });
  }

  private async runPhaseAllowlist(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    runDir: string,
  ): Promise<ContainerOutcome> {
    const allowlist = advanced.network.allowlist ?? [];
    let networks: Awaited<ReturnType<typeof createSubmissionNetworks>> | undefined;
    let proxyContainerName: string | undefined;
    try {
      networks = await createSubmissionNetworks(request.submissionId);
      const proxy = await startEgressProxy({
        submissionId: request.submissionId,
        internalName: networks.internalName,
        egressName: networks.egressName,
        allowlist,
        port: EGRESS_PROXY_PORT,
      });
      proxyContainerName = proxy.containerName;
      return await this.runContainer(request, advanced, config, imageRef, runDir, {
        networkArgs: ["--network", networks.internalName],
        extraEnv: buildProxyEnv(proxy.proxyUrl),
      });
    } catch (err) {
      return {
        exitCode: null,
        stderr: `egress setup failed: ${err instanceof Error ? err.message : String(err)}`,
        timedOut: false,
        sizeExceeded: false,
        spawnError: true,
      };
    } finally {
      if (proxyContainerName) {
        const audit = await collectEgressProxyLogs(proxyContainerName);
        if (audit) {
          logger.info("advanced egress-proxy audit log", {
            submissionId: request.submissionId,
            audit,
          });
        }
        stopEgressProxy(proxyContainerName);
      }
      if (networks) {
        removeSubmissionNetworks(networks);
      }
    }
  }

  private async runPhaseService(
    request: SandboxRequest,
    advanced: SandboxAdvancedRequest,
    config: AdvancedModeConfig,
    imageRef: string,
    runDir: string,
  ): Promise<ContainerOutcome> {
    const service = advanced.network.service;
    if (!service) {
      return {
        exitCode: null,
        stderr: "service network mode selected without a service image",
        timedOut: false,
        sizeExceeded: false,
        spawnError: true,
      };
    }

    let networks: Awaited<ReturnType<typeof createSubmissionNetworks>> | undefined;
    let serviceContainerName: string | undefined;
    try {
      const serviceImageRef = await this.resolveImageRef(service);
      networks = await createSubmissionNetworks(request.submissionId);
      const handle = await startServiceContainer({
        submissionId: request.submissionId,
        internalName: networks.internalName,
        egressName: networks.egressName,
        imageRef: serviceImageRef,
        memoryMb: advanced.memoryMb,
        cpuLimit: config.cpuLimit,
        pidsLimit: config.pidsLimit,
      });
      serviceContainerName = handle.containerName;
      return await this.runContainer(request, advanced, config, imageRef, runDir, {
        networkArgs: ["--network", networks.internalName],
        extraEnv: buildServiceEnv(),
      });
    } catch (err) {
      return {
        exitCode: null,
        stderr: `service setup failed: ${err instanceof Error ? err.message : String(err)}`,
        timedOut: false,
        sizeExceeded: false,
        spawnError: true,
      };
    } finally {
      if (serviceContainerName) {
        const serviceLogs = await collectServiceLogs(serviceContainerName);
        if (serviceLogs) {
          logger.info("advanced service container log", {
            submissionId: request.submissionId,
            serviceLogs,
          });
        }
        stopServiceContainer(serviceContainerName);
      }
      if (networks) {
        removeSubmissionNetworks(networks);
      }
    }
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
      readOnlyMounts: [
        { hostPath: join(gradeDir, "run-output"), containerPath: "/workspace/run-output" },
      ],
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
