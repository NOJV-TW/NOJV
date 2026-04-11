import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  advancedResultSchema,
  normalizeRelativePath,
  sourceFileNames,
  type AdvancedResult,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcaseResult,
  type SandboxVerdict
} from "@nojv/core";
import { createStorageClient, downloadAdvancedImageTarball } from "@nojv/storage";
import { parseSandboxResult } from "./sandbox-schema";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";

export interface DockerExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

// Map the TA image's top-level verdict onto the narrower SandboxVerdict.
// Exhaustive Record so a new AdvancedResult verdict fails at the type
// level until it gets an explicit mapping. `compile_error` is mapped to
// "RE" because Advanced Mode surfaces compile failures via the top-level
// `compilationError` field on SandboxResult, not as a per-testcase verdict.
const ADVANCED_VERDICT_TO_SANDBOX: Record<AdvancedResult["verdict"], SandboxVerdict> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
  runtime_error: "RE",
  compile_error: "RE"
};

export class DockerExecutor implements SandboxExecutor {
  private readonly config: DockerExecutorConfig;

  constructor(config: DockerExecutorConfig) {
    this.config = config;
  }

  async execute(request: SandboxRequest): Promise<SandboxResult> {
    const tempDir = await mkdtemp(
      join(tmpdir(), `nojv-judge-${sanitizeId(request.submissionId)}-`)
    );

    try {
      // Phase 7: advanced-mode submissions skip the sandbox-runner image
      // and spawn the TA-provided judge image directly. The workspace
      // layout follows the container contract documented in
      // docs/plans/active/2026-04-09-problem-ui-redesign.md.
      if (request.advanced) {
        return await this.runAdvancedContainer(tempDir, request);
      }
      await this.writeSubmissionFiles(tempDir, request);
      return await this.runContainer(tempDir, request);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async writeSubmissionFiles(tempDir: string, request: SandboxRequest): Promise<void> {
    const fileWrites: Promise<void>[] = [];
    const sourceFileMap: { path: string; key: string }[] = [];

    const defaultSourcePath = sourceFileNames[request.language];
    let wroteDefaultSource = false;

    for (const sourceFile of request.sourceFiles ?? []) {
      const normalizedPath = normalizeRelativePath(sourceFile.path);
      if (!normalizedPath) {
        continue;
      }

      if (normalizedPath === defaultSourcePath) {
        wroteDefaultSource = true;
      }

      const destination = join(tempDir, normalizedPath);
      sourceFileMap.push({ path: normalizedPath, key: normalizedPath });
      fileWrites.push(
        (async () => {
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, sourceFile.content, "utf8");
        })()
      );
    }

    if (!wroteDefaultSource) {
      fileWrites.push(writeFile(join(tempDir, defaultSourcePath), request.sourceCode, "utf8"));
    }

    fileWrites.push(
      writeFile(
        join(tempDir, "config.json"),
        JSON.stringify(buildSandboxConfigJson(request, sourceFileMap)),
        "utf8"
      )
    );

    if (request.judgeConfig.checkerScript) {
      const ext = sourceExtension(request.judgeConfig.checkerLanguage);
      fileWrites.push(
        writeFile(join(tempDir, `checker.${ext}`), request.judgeConfig.checkerScript, "utf8")
      );
    }

    if (request.judgeConfig.interactorScript) {
      const ext = sourceExtension(request.judgeConfig.interactorLanguage);
      fileWrites.push(
        writeFile(
          join(tempDir, `interactor.${ext}`),
          request.judgeConfig.interactorScript,
          "utf8"
        )
      );
    }

    await Promise.all(fileWrites);

    const testcasesDir = join(tempDir, "testcases");
    await mkdir(testcasesDir, { recursive: true });

    await Promise.all(
      request.testcases.map(async (tc) => {
        const tcDir = join(testcasesDir, String(tc.index));
        await mkdir(tcDir, { recursive: true });
        await writeFile(join(tcDir, "input.txt"), tc.input, "utf8");

        if (tc.expected !== undefined) {
          await writeFile(join(tcDir, "expected.txt"), tc.expected, "utf8");
        }
      })
    );

    // Create artifacts directory
    await mkdir(join(tempDir, "artifacts"), { recursive: true });

    // Make all files readable by the container's non-root user
    await chmod(tempDir, 0o755);
  }

  private async runContainer(tempDir: string, request: SandboxRequest): Promise<SandboxResult> {
    const containerName = `nojv-judge-${sanitizeId(request.submissionId).slice(0, 40)}`;
    const workDir = join(tempDir, "_workspace");
    await mkdir(workDir, { mode: 0o777, recursive: true });

    // Standard mode is hardcoded to --network none by design: student
    // submissions must never reach the network. Advanced mode has its
    // own container launch path (see runAdvancedContainer) which is
    // where request.advanced.networkEnabled is honored.
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
      "--read-only",
      "--tmpfs",
      "/tmp:rw,exec,nosuid,nodev,size=64m",
      "-v",
      `${tempDir}:/submission:ro`,
      "-v",
      `${workDir}:/workspace`,
      "--cpus",
      this.config.cpuLimit,
      "--memory",
      `${String(this.config.memoryMb)}m`,
      "--pids-limit",
      String(this.config.pidsLimit),
      "--env",
      "HOME=/tmp",
      this.config.image,
      "node",
      "/runner/index.js"
    ];

    // Outer timeout: container timeout + 30s grace for Docker overhead
    const outerTimeoutMs = request.limits.timeoutMs * request.testcases.length + 30_000;

    return await new Promise<SandboxResult>((resolve) => {
      const child = spawn("docker", args, { env: process.env, stdio: "pipe" });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const settle = (result: SandboxResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        forceRemoveContainer(containerName);
        child.kill("SIGKILL");
      }, outerTimeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error: Error) => {
        clearTimeout(timer);
        settle(sandboxSystemError(`Docker failed to start: ${error.message}`));
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);

        if (timedOut) {
          settle(sandboxSystemError("Sandbox execution timed out."));
          return;
        }

        if (exitCode !== 0) {
          settle(
            sandboxSystemError(
              `Sandbox exited with code ${String(exitCode)}.\n${stderr}`.trim()
            )
          );
          return;
        }

        try {
          const parsed = parseSandboxResult(JSON.parse(stdout));
          settle(
            parsed.success
              ? parsed.data
              : sandboxSystemError(
                  `Failed to parse sandbox output.\nstdout: ${stdout}\nstderr: ${stderr}`
                )
          );
        } catch {
          settle(
            sandboxSystemError(
              `Failed to parse sandbox output.\nstdout: ${stdout}\nstderr: ${stderr}`
            )
          );
        }
      });

      child.stdin.end();
    });
  }

  /**
   * Phase 7 — Advanced Mode dispatch.
   *
   * Lay out /workspace per the advanced container contract and spawn
   * the TA-provided image directly (no sandbox-runner intermediate).
   * The TA image is expected to:
   *   1. Read /workspace/submission/, /workspace/testcases/N/,
   *      /workspace/meta.json
   *   2. Do whatever grading it wants (compile, run, compare, ...)
   *   3. Write /workspace/output/result.json matching
   *      advancedResultSchema
   * On timeout, crash, or missing result.json we return a synthetic
   * SE verdict for every testcase.
   */
  private async runAdvancedContainer(
    tempDir: string,
    request: SandboxRequest
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
        return this.advancedFallbackResult(
          request,
          `Failed to load advanced image tarball: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const workspaceDir = join(tempDir, "workspace");
    const submissionDir = join(workspaceDir, "submission");
    const testcasesRoot = join(workspaceDir, "testcases");
    const outputDir = join(workspaceDir, "output");
    await mkdir(workspaceDir, { mode: 0o777, recursive: true });
    await mkdir(submissionDir, { mode: 0o777, recursive: true });
    await mkdir(testcasesRoot, { mode: 0o777, recursive: true });
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

    // 2. Testcases → /workspace/testcases/N/
    for (const [i, tc] of request.testcases.entries()) {
      const tcDir = join(testcasesRoot, String(i));
      fileWrites.push(
        (async () => {
          await mkdir(tcDir, { recursive: true });
          await writeFile(join(tcDir, "stdin"), tc.input, "utf8");
          if (tc.expected !== undefined) {
            await writeFile(join(tcDir, "expected"), tc.expected, "utf8");
          }
        })()
      );

      const perCaseFiles = request.advanced.testcaseFiles?.[i];
      if (perCaseFiles) {
        for (const [relPath, content] of Object.entries(perCaseFiles)) {
          const normalized = normalizeRelativePath(relPath);
          if (!normalized) continue;
          const dest = join(tcDir, "files", normalized);
          fileWrites.push(
            (async () => {
              await mkdir(dirname(dest), { recursive: true });
              await writeFile(dest, content, "utf8");
            })()
          );
        }
      }
    }

    // 3. meta.json
    const meta = {
      submissionId: request.submissionId,
      numTestcases: request.testcases.length,
      language: request.language,
      submissionFiles: [defaultSourcePath],
      resourceLimits: {
        totalTimeMs: request.advanced.totalTimeMs,
        memoryMb: request.advanced.memoryMb,
        networkEnabled: request.advanced.networkEnabled
      }
    };
    fileWrites.push(
      writeFile(join(workspaceDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8")
    );

    await Promise.all(fileWrites);
    await chmod(workspaceDir, 0o777);

    // 4. Spawn the TA image
    const containerName = `nojv-advanced-${sanitizeId(request.submissionId).slice(0, 40)}`;
    // Advanced Mode containers are TA-provided and run with the
    // TA's chosen network mode. When networkEnabled is true, the
    // container joins the default Docker bridge network — this
    // grants access to other Docker networks and the host gateway,
    // so advanced-mode images must be treated as trusted code
    // provided by the problem author. Students never pick the
    // network mode; it's configured on the Problem row by the TA.
    const networkArgs = request.advanced.networkEnabled
      ? ["--network", "bridge"]
      : ["--network", "none"];

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
      this.config.cpuLimit,
      "--memory",
      `${String(request.advanced.memoryMb)}m`,
      "--pids-limit",
      String(this.config.pidsLimit),
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
      return this.advancedFallbackResult(request, "Advanced judge image timed out.");
    }

    // 5. Read /workspace/output/result.json
    let resultJson: unknown;
    try {
      const raw = await readFile(join(outputDir, "result.json"), "utf8");
      resultJson = JSON.parse(raw);
    } catch {
      return this.advancedFallbackResult(
        request,
        `Advanced judge image did not write result.json. exit=${String(dockerOutcome.exitCode)}\n${dockerOutcome.stderr}`.trim()
      );
    }

    const parsed = advancedResultSchema.safeParse(resultJson);
    if (!parsed.success) {
      return this.advancedFallbackResult(
        request,
        `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`
      );
    }

    return this.mapAdvancedResult(request, parsed.data);
  }

  /**
   * Stream a tarball out of object storage and `docker load` it into
   * the local daemon. Returns the loaded image reference (e.g.
   * `sha256:abcdef…` or `my-image:latest`) for use in `docker run`.
   *
   * Cached per-storage-key: once an image is loaded for a given key,
   * subsequent calls reuse the cached ref without re-downloading or
   * re-loading. Invalidate the cache by restarting the worker.
   */
  private readonly loadedTarballs = new Map<string, string>();

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

  private advancedFallbackResult(request: SandboxRequest, message: string): SandboxResult {
    return {
      testcaseResults: request.testcases.map((tc) => ({
        index: tc.index,
        verdict: "SE" as SandboxVerdict,
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        feedback: message
      }))
    };
  }

  private mapAdvancedResult(request: SandboxRequest, result: AdvancedResult): SandboxResult {
    const perCase = new Map(result.testcases?.map((t) => [t.index, t]) ?? []);
    const testcaseResults: SandboxTestcaseResult[] = request.testcases.map((tc) => {
      const entry = perCase.get(tc.index);
      if (entry) {
        return {
          index: tc.index,
          verdict: entry.verdict,
          stdout: "",
          stderr: "",
          exitCode: 0,
          timeMs: entry.runtimeMs ?? 0,
          ...(entry.feedback ? { feedback: entry.feedback } : {})
        };
      }
      // Fall back to the top-level verdict when the image didn't provide
      // per-case details.
      return {
        index: tc.index,
        verdict: ADVANCED_VERDICT_TO_SANDBOX[result.verdict],
        stdout: "",
        stderr: "",
        exitCode: 0,
        timeMs: 0,
        ...(result.feedback ? { feedback: result.feedback } : {})
      };
    });

    return {
      testcaseResults,
      customScore: result.score,
      ...(result.feedback ? { scoringFeedback: result.feedback } : {})
    };
  }
}

function forceRemoveContainer(containerName: string): void {
  const child = spawn("docker", ["rm", "-f", containerName], {
    env: process.env,
    stdio: "pipe"
  });

  child.stdin.end();
  child.on("error", () => undefined);
}
