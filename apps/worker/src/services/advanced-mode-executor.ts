import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  advancedResultSchema,
  normalizeRelativePath,
  sourceFileNames,
  type SandboxRequest,
  type SandboxResult
} from "@nojv/core";
import { createStorageClient, downloadAdvancedImageTarball } from "@nojv/storage";

import { forceRemoveContainer, sanitizeId } from "./docker-process";
import { sandboxSystemError } from "./sandbox-plan";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";

export interface AdvancedModeConfig {
  cpuLimit: string;
  pidsLimit: number;
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
    config: AdvancedModeConfig
  ): Promise<SandboxResult> {
    if (!request.advanced) {
      return sandboxSystemError("advanced-mode dispatch called without payload");
    }

    // If the image was uploaded as a tarball, stream it out of storage
    // and load it into the local docker daemon before dispatching.
    // The resulting image tag is parsed from `docker load` output.
    let imageRef = request.advanced.imageRef;
    if (request.advanced.imageSource === "tarball") {
      try {
        imageRef = await this.ensureTarballLoaded(request.advanced.imageRef);
      } catch (err) {
        return advancedFallbackResult(
          request,
          `Failed to load advanced image tarball: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const workspaceDir = join(tempDir, "workspace");
    const submissionDir = join(workspaceDir, "submission");
    const outputDir = join(workspaceDir, "output");
    await mkdir(workspaceDir, { mode: 0o777, recursive: true });
    await mkdir(submissionDir, { mode: 0o777, recursive: true });
    await mkdir(outputDir, { mode: 0o777, recursive: true });

    // 1. Student sources → /workspace/submission/
    const fileWrites: Promise<void>[] = [];
    const defaultSourcePath = sourceFileNames[request.language];
    let wroteDefault = false;

    for (const sf of request.sourceFiles ?? []) {
      const normalized = normalizeRelativePath(sf.path);
      if (!normalized) continue;
      if (normalized === defaultSourcePath) wroteDefault = true;
      const dest = join(submissionDir, normalized);
      fileWrites.push(
        (async () => {
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, sf.content, "utf8");
        })()
      );
    }
    if (!wroteDefault && request.sourceCode) {
      fileWrites.push(
        writeFile(join(submissionDir, defaultSourcePath), request.sourceCode, "utf8")
      );
    }

    // 2. meta.json — tells the TA image what it's grading.
    const meta = {
      submissionId: request.submissionId,
      language: request.language,
      submissionFiles: [defaultSourcePath],
      resourceLimits: {
        totalTimeMs: request.advanced.totalTimeMs,
        memoryMb: request.advanced.memoryMb
      }
    };
    fileWrites.push(
      writeFile(join(workspaceDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8")
    );

    await Promise.all(fileWrites);
    await chmod(workspaceDir, 0o777);

    // 4. Spawn the TA image
    const containerName = `nojv-advanced-${sanitizeId(request.submissionId).slice(0, 40)}`;
    // Advanced Mode containers are fully network-isolated. Any packages
    // or test data the TA image needs must be baked into the image at
    // build time — runtime fetches are not allowed.
    const networkArgs = ["--network", "none"];

    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      ...networkArgs,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${workspaceDir}:/workspace`,
      "--cpus",
      config.cpuLimit,
      "--memory",
      `${String(request.advanced.memoryMb)}m`,
      "--pids-limit",
      String(config.pidsLimit),
      "--workdir",
      "/workspace",
      imageRef
    ];

    const outerTimeoutMs = request.advanced.totalTimeMs + 30_000;

    const dockerOutcome = await new Promise<{
      exitCode: number | null;
      stderr: string;
      timedOut: boolean;
    }>((resolve) => {
      const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const settle = (value: {
        exitCode: number | null;
        stderr: string;
        timedOut: boolean;
      }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        forceRemoveContainer(containerName);
        child.kill("SIGKILL");
      }, outerTimeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        settle({ exitCode: null, stderr: `spawn failed: ${err.message}`, timedOut: false });
      });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        settle({ exitCode: code, stderr, timedOut });
      });

      child.stdin.end();
    });

    if (dockerOutcome.timedOut) {
      return advancedFallbackResult(request, "Advanced judge image timed out.");
    }

    // 5. Read /workspace/output/result.json
    let resultJson: unknown;
    try {
      const raw = await readFile(join(outputDir, "result.json"), "utf8");
      resultJson = JSON.parse(raw);
    } catch {
      return advancedFallbackResult(
        request,
        `Advanced judge image did not write result.json. exit=${String(dockerOutcome.exitCode)}\n${dockerOutcome.stderr}`.trim()
      );
    }

    const parsed = advancedResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      return advancedFallbackResult(
        request,
        `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`
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
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (c: string) => {
        stdout += c;
      });
      child.stderr.on("data", (c: string) => {
        stderr += c;
      });
      child.on("error", (err: Error) => reject(err));
      child.on("close", (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`docker load exited ${String(code)}: ${stderr.trim()}`));
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
