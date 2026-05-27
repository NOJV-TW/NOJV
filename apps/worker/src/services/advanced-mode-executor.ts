import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  advancedResultSchema,
  normalizeRelativePath,
  sourceFileNames,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";
import { createStorageClient, downloadAdvancedImageTarball } from "@nojv/storage";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { sandboxSystemError } from "./sandbox-plan";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";

export interface AdvancedModeConfig {
  cpuLimit: string;
  pidsLimit: number;
}

// Cap on the host-bind-mounted /workspace dir. The TA image is trusted, but a
// buggy run could fill the worker disk. result.json + artifacts must fit under
// this. `--storage-opt size=` only works on devicemapper/btrfs, not overlay2,
// so we poll the dir size instead and force-kill on exceed.
const ADVANCED_WORKSPACE_MAX_BYTES = 1024 * 1024 * 1024;
const WORKSPACE_POLL_INTERVAL_MS = 2_000;

async function dirSizeBytes(dir: string): Promise<number> {
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
      // Entry vanished mid-walk (container churning files) — skip it.
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
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "-v",
    `${params.workspaceDir}:/workspace`,
    "--cpus",
    params.cpuLimit,
    "--memory",
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
  // Cached per-storage-key: once an image is loaded for a given key,
  // subsequent calls reuse the cached ref without re-downloading or
  // re-loading. Invalidate the cache by restarting the worker.
  private readonly loadedTarballs = new Map<string, string>();

  /**
   * Advanced Mode dispatch.
   *
   * Lay out /workspace per the advanced container contract and spawn
   * the TA-provided image directly (no sandbox-runner intermediate).
   * The TA image is expected to:
   *   1. Read /workspace/submission/ and /workspace/meta.json
   *   2. Do whatever grading it wants (compile, run, compare, ...) —
   *      testcases are bundled inside the image itself
   *   3. Write /workspace/output/result.json matching
   *      advancedResultSchema
   * On timeout, crash, or missing result.json we return a synthetic
   * SE result.
   */
  async run(
    tempDir: string,
    request: SandboxRequest,
    config: AdvancedModeConfig,
  ): Promise<SandboxResult> {
    const advanced = request.advanced;
    if (!advanced) {
      return sandboxSystemError("advanced-mode dispatch called without payload");
    }

    // If the image was uploaded as a tarball, stream it out of storage
    // and load it into the local docker daemon before dispatching.
    // The resulting image tag is parsed from `docker load` output.
    let imageRef = advanced.imageRef;
    if (advanced.imageSource === "tarball") {
      try {
        imageRef = await this.ensureTarballLoaded(advanced.imageRef);
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
    const defaultSourcePath = sourceFileNames[request.language];

    const prepareWorkspace = async (): Promise<void> => {
      await mkdir(workspaceDir, { mode: 0o777, recursive: true });
      await mkdir(submissionDir, { mode: 0o777, recursive: true });
      await mkdir(outputDir, { mode: 0o777, recursive: true });

      const fileWrites: Promise<void>[] = [];
      const writtenPaths: string[] = [];
      let wroteDefault = false;

      for (const sf of request.sourceFiles ?? []) {
        const normalized = normalizeRelativePath(sf.path);
        if (!normalized) continue;
        if (normalized === defaultSourcePath) wroteDefault = true;
        writtenPaths.push(normalized);
        const dest = join(submissionDir, normalized);
        fileWrites.push(
          (async () => {
            await mkdir(dirname(dest), { recursive: true });
            await writeFile(dest, sf.content, "utf8");
          })(),
        );
      }
      if (!wroteDefault && request.sourceCode) {
        writtenPaths.push(defaultSourcePath);
        fileWrites.push(
          writeFile(join(submissionDir, defaultSourcePath), request.sourceCode, "utf8"),
        );
      }

      const meta = {
        submissionId: request.submissionId,
        language: request.language,
        submissionFiles: writtenPaths,
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
      // Advanced Mode containers are fully network-isolated. Any packages
      // or test data the TA image needs must be baked into the image at
      // build time — runtime fetches are not allowed.
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

        // Disk-cap watchdog: overlay2 ignores `--storage-opt size=`, so poll the
        // bind-mounted host dir and force-kill if the image writes past the cap.
        const sizePoll = setInterval(() => {
          if (sizeCheckInFlight) return;
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

  /**
   * Stream a tarball out of object storage and `docker load` it into
   * the local daemon. Returns the loaded image reference (e.g.
   * `sha256:abcdef…` or `my-image:latest`) for use in `docker run`.
   */
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
        // `docker load -q` prints "sha256:…" or "Loaded image: name:tag".
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
