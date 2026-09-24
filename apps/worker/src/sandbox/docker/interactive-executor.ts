import { spawn, type ChildProcessByStdio } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  COMPILATION_TIMEOUT_MS,
  executionWallTimeLimitMs,
  validatorTimeoutMs,
  type SandboxRequest,
  type SandboxExecutionContext,
  type SandboxResult,
} from "@nojv/core";

import { createBoundedStringBuffer } from "../shared/bounded-buffer";
import {
  resolveInteractiveStage,
  type InteractiveSideResult,
} from "../shared/check-interactive";
import { buildSandboxDockerArgs } from "./args";
import {
  attachDockerCleanupFailure,
  cleanupDockerResources,
  forceRemoveContainer,
  sanitizeId,
} from "./process";
import { buildDockerResourceLabels } from "./resource";
import { executionAbortReason } from "../shared/execution-abort";
import {
  buildSandboxConfigJson,
  sandboxSystemError,
  sourceExtension,
} from "../shared/sandbox-plan";
import { resolveSourceFiles } from "../shared/source-files.js";

const MAX_OUTER_TIMEOUT_MS = 540_000;
const PER_CASE_GRACE_MS = 5_000;
const STAGE_GRACE_MS = 35_000;

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
    const key = `source-file-${String(sourceFileMap.length)}`;
    sourceFileMap.push({ path: sf.path, key });
    fileWrites.push(writeFile(join(tempDir, key), sf.content, "utf8"));
  }

  const config = {
    ...buildSandboxConfigJson(request, sourceFileMap),
    interactive: { role: "solution", cases: request.testcases.map((tc) => tc.index) },
  };
  fileWrites.push(writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"));

  await Promise.all(fileWrites);
  await chmod(tempDir, 0o755);
}

export async function writeInteractorFiles(
  tempDir: string,
  request: SandboxRequest,
  interactorScript: string,
  interactorLanguage: "python" | "cpp",
): Promise<void> {
  const ext = sourceExtension(interactorLanguage);
  const cases = request.testcases.map((tc) => tc.index);

  const config = {
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    interactorLanguage,
    interactive: { role: "validator", language: interactorLanguage, cases },
  };

  await Promise.all([
    writeFile(join(tempDir, `interactor.${ext}`), interactorScript, "utf8"),
    writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"),
    ...request.testcases.flatMap((tc) => [
      writeFile(join(tempDir, `case-${String(tc.index)}-input.txt`), tc.input, "utf8"),
      writeFile(join(tempDir, `case-${String(tc.index)}-answer.txt`), tc.output ?? "", "utf8"),
    ]),
  ]);

  await chmod(tempDir, 0o755);
}

export function interactiveStageTimeoutMs(request: SandboxRequest): number {
  const perCase =
    Math.max(
      executionWallTimeLimitMs(request.limits.timeoutMs),
      validatorTimeoutMs(request.limits.timeoutMs),
    ) + PER_CASE_GRACE_MS;
  return Math.min(
    COMPILATION_TIMEOUT_MS + perCase * Math.max(1, request.testcases.length) + STAGE_GRACE_MS,
    MAX_OUTER_TIMEOUT_MS,
  );
}

async function runStage(
  request: SandboxRequest,
  execution: SandboxExecutionContext,
  interactorScript: string,
  interactorLanguage: "python" | "cpp",
  config: InteractiveExecutorConfig,
): Promise<SandboxResult> {
  const slug = sanitizeId(execution.runId).slice(0, 32);
  const solName = `nojv-isol-${slug}`;
  const intName = `nojv-iint-${slug}`;

  const solDir = await mkdtemp(join(tmpdir(), `nojv-isol-${slug}-`));
  const intDir = await mkdtemp(join(tmpdir(), `nojv-iint-${slug}-`));

  try {
    await Promise.all([
      writeSolutionFiles(solDir, request),
      writeInteractorFiles(intDir, request, interactorScript, interactorLanguage),
    ]);

    execution.signal.throwIfAborted();

    const outerTimeoutMs = interactiveStageTimeoutMs(request);

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

    return resolveInteractiveStage(request.testcases, sol, int);
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
  const interactorLanguage = request.judgeConfig.interactorLanguage;
  if (!interactorLanguage) throw new Error("Interactive judge is missing interactorLanguage.");

  return await runStage(request, execution, interactorScript, interactorLanguage, config);
}
