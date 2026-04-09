import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  normalizeRelativePath,
  sourceFileNames,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult
} from "@nojv/core";
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

    // Phase 5: network access is no longer configured per-request.
    // Standard mode always runs with --network none. Advanced mode is
    // dispatched via a separate code path that decides networking
    // based on request.advanced.networkEnabled.
    const advancedNetwork = request.advanced?.networkEnabled === true;
    const networkArgs = advancedNetwork ? this.buildNetworkArgs() : ["--network", "none"];

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
   * Build Docker network arguments for controlled network access.
   *
   * When network access is enabled, we use a bridge network with iptables
   * rules to restrict traffic to allowed destinations only.
   * For now, we use the default bridge network. In production, a dedicated
   * Docker network with iptables firewall rules should be configured.
   */
  private buildNetworkArgs(): string[] {
    // TODO: Bridge network should only be enabled once host-level iptables
    // enforcement is implemented. Until then, default to --network none
    // to prevent unrestricted internet access from sandboxed submissions.
    return ["--network", "none"];
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
