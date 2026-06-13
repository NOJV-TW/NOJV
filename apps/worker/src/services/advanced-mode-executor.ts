import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { advancedResultSchema, type SandboxRequest, type SandboxResult } from "@nojv/core";
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
    "--user",
    "10001:10001",
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

    let imageRef = advanced.grade.imageRef;
    if (advanced.grade.imageSource === "tarball") {
      try {
        imageRef = await this.ensureTarballLoaded(advanced.grade.imageRef);
      } catch (err) {
        return advancedFallbackResult(
          request,
          `Failed to load advanced image tarball: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const workspaceDir = join(tempDir, "workspace");
    const submissionDir = join(workspaceDir, "submission");
    const outputDir = join(workspaceDir, "output");

    const prepareWorkspace = async (): Promise<void> => {
      await mkdir(workspaceDir, { mode: 0o777, recursive: true });
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
        submissionId: request.submissionId,
        language: request.language,
        submissionFiles: resolved.map((f) => f.path),
        resourceLimits: {
          totalTimeMs: advanced.totalTimeMs,
          memoryMb: advanced.memoryMb,
        },
      };
      fileWrites.push(
        writeFile(join(workspaceDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8"),
      );

      await Promise.all(fileWrites);
      await chmod(workspaceDir, 0o777);
    };

    const spawnContainer = (): Promise<{
      exitCode: number | null;
      stderr: string;
      timedOut: boolean;
      sizeExceeded: boolean;
    }> => {
      const containerName = `nojv-advanced-${sanitizeId(request.submissionId).slice(0, 40)}`;
      const networkArgs = ["--network", "none"];

      const args = buildAdvancedDockerArgs({
        containerName,
        networkArgs,
        workspaceDir,
        cpuLimit: config.cpuLimit,
        memoryMb: advanced.memoryMb,
        pidsLimit: config.pidsLimit,
        imageRef,
        submissionId: request.submissionId,
        language: request.language,
      });

      const outerTimeoutMs = advanced.totalTimeMs + 30_000;

      forceRemoveContainerSync(containerName);

      return new Promise((resolve) => {
        const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
        const stderrBuf = createBoundedStringBuffer();
        let timedOut = false;
        let sizeExceeded = false;
        let settled = false;
        let sizeCheckInFlight = false;

        const settle = (value: {
          exitCode: number | null;
          stderr: string;
          timedOut: boolean;
          sizeExceeded: boolean;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(sizePoll);
          resolve(value);
        };

        const timer = setTimeout(() => {
          timedOut = true;
          forceRemoveContainer(containerName);
          child.kill("SIGKILL");
        }, outerTimeoutMs);

        const sizePoll = setInterval(() => {
          if (sizeExceeded || sizeCheckInFlight) return;
          sizeCheckInFlight = true;
          void dirSizeBytes(workspaceDir)
            .then((bytes) => {
              if (bytes > ADVANCED_WORKSPACE_MAX_BYTES) {
                sizeExceeded = true;
                forceRemoveContainer(containerName);
                child.kill("SIGKILL");
              }
            })
            .finally(() => {
              sizeCheckInFlight = false;
            });
        }, WORKSPACE_POLL_INTERVAL_MS);

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
          });
        });

        child.on("close", (code: number | null) => {
          settle({ exitCode: code, stderr: stderrBuf.toString(), timedOut, sizeExceeded });
        });

        child.stdin.end();
      });
    };

    await prepareWorkspace();
    const dockerOutcome = await spawnContainer();

    if (dockerOutcome.sizeExceeded) {
      return advancedFallbackResult(
        request,
        "Advanced judge image exceeded the output size limit.",
      );
    }

    if (dockerOutcome.timedOut) {
      return advancedFallbackResult(request, "Advanced judge image timed out.");
    }

    let resultJson: unknown;
    try {
      const raw = await readFile(join(outputDir, "result.json"), "utf8");
      resultJson = JSON.parse(raw);
    } catch {
      return advancedFallbackResult(
        request,
        `Advanced judge image did not write result.json. exit=${String(dockerOutcome.exitCode)}\n${dockerOutcome.stderr}`.trim(),
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
