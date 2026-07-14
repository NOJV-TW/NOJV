import { spawn, type ChildProcessByStdio } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  type SandboxRequest,
  type SandboxExecutionContext,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
} from "@nojv/core";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { mergeInteractiveCase, type InteractiveSideResult } from "./check-interactive";
import { buildSandboxDockerArgs } from "./docker-args";
import {
  attachDockerCleanupFailure,
  cleanupDockerResources,
  forceRemoveContainer,
  sanitizeId,
} from "./docker-process";
import { buildDockerResourceLabels } from "./docker-resource";
import { executionAbortReason } from "./execution-abort";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";
import { resolveSourceFiles } from "./source-files.js";

export { mergeInteractiveCase } from "./check-interactive";

const MAX_OUTER_TIMEOUT_MS = 540_000;
const PER_CASE_GRACE_MS = 35_000;

function endStdin(stream: Writable): void {
  try {
    stream.end();
  } catch {
    return;
  }
}

export interface InteractiveExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

export async function writeSolutionFiles(
  tempDir: string,
  request: SandboxRequest,
): Promise<void> {
  const fileWrites: Promise<void>[] = [];
  const sourceFileMap: { path: string; key: string }[] = [];

  for (const sf of resolveSourceFiles(request)) {
    const destination = join(tempDir, sf.path);
    sourceFileMap.push({ path: sf.path, key: sf.path });
    fileWrites.push(
      (async () => {
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, sf.content, "utf8");
      })(),
    );
  }

  const config = {
    ...buildSandboxConfigJson(request, sourceFileMap),
    interactive: { role: "solution" },
  };
  fileWrites.push(writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"));

  await Promise.all(fileWrites);
  await chmod(tempDir, 0o755);
}

export async function writeInteractorFiles(
  tempDir: string,
  request: SandboxRequest,
  testcase: SandboxTestcase,
  interactorScript: string,
  interactorLanguage: "python" | "cpp",
): Promise<void> {
  const ext = sourceExtension(interactorLanguage);

  const config = {
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    interactorLanguage,
    interactive: { role: "validator", language: interactorLanguage, index: testcase.index },
  };

  const caseDir = join(tempDir, "cases", String(testcase.index));
  await mkdir(caseDir, { recursive: true });

  await Promise.all([
    writeFile(join(tempDir, `interactor.${ext}`), interactorScript, "utf8"),
    writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"),
    writeFile(join(caseDir, "input.txt"), testcase.input, "utf8"),
    writeFile(join(caseDir, "answer.txt"), testcase.output ?? "", "utf8"),
  ]);

  await chmod(tempDir, 0o755);
}

async function runCase(
  request: SandboxRequest,
  execution: SandboxExecutionContext,
  testcase: SandboxTestcase,
  interactorScript: string,
  interactorLanguage: "python" | "cpp",
  config: InteractiveExecutorConfig,
): Promise<SandboxTestcaseResult> {
  const slug = sanitizeId(execution.runId).slice(0, 32);
  const solName = `nojv-isol-${slug}-${String(testcase.index)}`;
  const intName = `nojv-iint-${slug}-${String(testcase.index)}`;

  const solDir = await mkdtemp(join(tmpdir(), `nojv-isol-${slug}-`));
  const intDir = await mkdtemp(join(tmpdir(), `nojv-iint-${slug}-`));

  try {
    await Promise.all([
      writeSolutionFiles(solDir, request),
      writeInteractorFiles(intDir, request, testcase, interactorScript, interactorLanguage),
    ]);

    execution.signal.throwIfAborted();

    const outerTimeoutMs = Math.min(
      request.limits.timeoutMs + PER_CASE_GRACE_MS,
      MAX_OUTER_TIMEOUT_MS,
    );

    const { sol, int } = await new Promise<{
      sol: InteractiveSideResult;
      int: InteractiveSideResult;
    }>((resolve, reject) => {
      const solChild = spawn(
        "docker",
        buildSandboxDockerArgs({
          containerName: solName,
          networkArgs: ["--network", "none"],
          tempDir: solDir,
          cpuLimit: config.cpuLimit,
          memoryMb: config.memoryMb,
          pidsLimit: config.pidsLimit,
          image: config.image,
          interactive: true,
          labels: buildDockerResourceLabels(execution.runId),
        }),
        { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
      ) as PipedChild;

      const intChild = spawn(
        "docker",
        buildSandboxDockerArgs({
          containerName: intName,
          networkArgs: ["--network", "none"],
          tempDir: intDir,
          cpuLimit: config.cpuLimit,
          memoryMb: config.memoryMb,
          pidsLimit: config.pidsLimit,
          image: config.image,
          interactive: true,
          labels: buildDockerResourceLabels(execution.runId),
        }),
        { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
      ) as PipedChild;

      solChild.stdout.pipe(intChild.stdin);
      intChild.stdout.pipe(solChild.stdin);
      solChild.stdin.on("error", () => undefined);
      intChild.stdin.on("error", () => undefined);

      const solStderr = createBoundedStringBuffer();
      const intStderr = createBoundedStringBuffer();
      solChild.stderr.setEncoding("utf8");
      intChild.stderr.setEncoding("utf8");
      solChild.stderr.on("data", (c: string) => solStderr.push(c));
      intChild.stderr.on("data", (c: string) => intStderr.push(c));

      let solClosed = false;
      let intClosed = false;
      let solSpawnError = false;
      let intSpawnError = false;
      let timedOut = false;
      let settled = false;
      let termination: "abort" | "timeout" | null = null;
      let cleanup: Promise<void> | null = null;

      const finish = () => {
        if (settled || termination || !solClosed || !intClosed) return;
        settled = true;
        clearTimeout(timer);
        execution.signal.removeEventListener("abort", abort);
        resolve({
          sol: { stderr: solStderr.toString(), timedOut, spawnError: solSpawnError },
          int: { stderr: intStderr.toString(), timedOut, spawnError: intSpawnError },
        });
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        execution.signal.removeEventListener("abort", abort);
        reject(error);
      };

      const settleTermination = (cleanupError?: unknown) => {
        if (settled) return;
        if (execution.signal.aborted) {
          const abortReason = executionAbortReason(execution.signal);
          fail(
            cleanupError === undefined
              ? abortReason
              : attachDockerCleanupFailure(abortReason, "Interactive sandbox", cleanupError),
          );
          return;
        }
        if (termination !== "timeout") return;
        if (cleanupError !== undefined) {
          fail(
            attachDockerCleanupFailure(
              new Error("Interactive sandbox timed out."),
              "Interactive sandbox",
              cleanupError,
            ),
          );
          return;
        }
        solClosed = true;
        intClosed = true;
        termination = null;
        finish();
      };

      const terminate = () => {
        if (cleanup) return;
        solChild.kill("SIGKILL");
        intChild.kill("SIGKILL");
        cleanup = cleanupDockerResources("Interactive containers", [
          { name: solName, remove: () => forceRemoveContainer(solName) },
          { name: intName, remove: () => forceRemoveContainer(intName) },
        ]);
        void cleanup.then(
          () => settleTermination(),
          (error: unknown) => settleTermination(error),
        );
      };

      const abort = () => {
        termination = "abort";
        terminate();
      };
      execution.signal.addEventListener("abort", abort, { once: true });

      const timer = setTimeout(() => {
        timedOut = true;
        termination = "timeout";
        terminate();
      }, outerTimeoutMs);
      if (execution.signal.aborted) abort();

      solChild.on("error", (err: Error) => {
        solSpawnError = true;
        solClosed = true;
        solStderr.push(`spawn failed: ${err.message}`);
        finish();
      });
      intChild.on("error", (err: Error) => {
        intSpawnError = true;
        intClosed = true;
        intStderr.push(`spawn failed: ${err.message}`);
        finish();
      });
      solChild.on("close", () => {
        solClosed = true;
        endStdin(intChild.stdin);
        finish();
      });
      intChild.on("close", () => {
        intClosed = true;
        endStdin(solChild.stdin);
        finish();
      });
    });

    return mergeInteractiveCase(testcase, sol, int);
  } finally {
    await Promise.all([
      rm(solDir, { force: true, recursive: true }),
      rm(intDir, { force: true, recursive: true }),
    ]);
  }
}

export async function runInteractiveMode(
  request: SandboxRequest,
  execution: SandboxExecutionContext,
  config: InteractiveExecutorConfig,
): Promise<SandboxResult> {
  const interactorScript = request.judgeConfig.interactorScript;
  if (!interactorScript) {
    return sandboxSystemError("Interactive judge is missing its interactor script.");
  }
  const checkerFallbackLanguage =
    request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";
  const interactorLanguage =
    request.judgeConfig.interactorLanguage === "cpp" ? "cpp" : checkerFallbackLanguage;

  const results: SandboxTestcaseResult[] = [];
  for (const testcase of request.testcases) {
    results.push(
      await runCase(request, execution, testcase, interactorScript, interactorLanguage, config),
    );
  }

  return { testcaseResults: results };
}
