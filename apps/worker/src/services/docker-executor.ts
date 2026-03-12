import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  sourceFileNames,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult
} from "@nojv/sandbox";

export interface DockerExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

const languageExtensions: Record<SandboxRequest["language"], string> = {
  c: ".c",
  cpp: ".cpp",
  go: ".go",
  java: ".java",
  javascript: ".js",
  python: ".py",
  rust: ".rs",
  typescript: ".ts"
};

function resolveScriptExtension(language: string | undefined): string {
  if (language && language in languageExtensions) {
    return languageExtensions[language as SandboxRequest["language"]];
  }
  return ".py";
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
    const config = {
      submissionId: request.submissionId,
      language: request.language,
      judgeType: request.judgeType,
      submissionType: request.submissionType,
      limits: request.limits,
      ...(request.template ? { template: request.template } : {}),
      ...(request.judgeConfig.checkerLanguage
        ? { checkerLanguage: request.judgeConfig.checkerLanguage }
        : {})
    };

    const fileWrites: Promise<void>[] = [
      writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"),
      writeFile(join(tempDir, sourceFileNames[request.language]), request.sourceCode, "utf8")
    ];

    if (request.judgeConfig.checkerScript) {
      const checkerExt = resolveScriptExtension(request.judgeConfig.checkerLanguage);
      fileWrites.push(
        writeFile(
          join(tempDir, `checker${checkerExt}`),
          request.judgeConfig.checkerScript,
          "utf8"
        )
      );
    }

    if (request.judgeConfig.interactorScript) {
      const interactorExt = resolveScriptExtension(request.judgeConfig.checkerLanguage);
      fileWrites.push(
        writeFile(
          join(tempDir, `interactor${interactorExt}`),
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

    // Make all files readable by the container's non-root user
    await chmod(tempDir, 0o755);
  }

  private async runContainer(tempDir: string, request: SandboxRequest): Promise<SandboxResult> {
    const containerName = `nojv-judge-${sanitizeId(request.submissionId).slice(0, 40)}`;
    const workDir = join(tempDir, "_workspace");
    await mkdir(workDir, { mode: 0o777, recursive: true });

    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--network",
      "none",
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
        settle(systemError(`Docker failed to start: ${error.message}`));
      });

      child.on("close", (exitCode: number | null) => {
        clearTimeout(timer);

        if (timedOut) {
          settle(systemError("Sandbox execution timed out."));
          return;
        }

        if (exitCode !== 0) {
          settle(
            systemError(`Sandbox exited with code ${String(exitCode)}.\n${stderr}`.trim())
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as SandboxResult;
          settle(parsed);
        } catch {
          settle(
            systemError(`Failed to parse sandbox output.\nstdout: ${stdout}\nstderr: ${stderr}`)
          );
        }
      });

      child.stdin.end();
    });
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

function systemError(message: string): SandboxResult {
  return {
    testcaseResults: [
      {
        exitCode: -1,
        feedback: message,
        index: 0,
        stderr: message,
        stdout: "",
        timeMs: 0,
        verdict: "SE"
      }
    ]
  };
}
