import { spawn, type ChildProcessByStdio } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

import {
  normalizeRelativePath,
  sourceFileNames,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
} from "@nojv/core";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { mergeInteractiveCase, type InteractiveSideResult } from "./check-interactive";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";

export { mergeInteractiveCase } from "./check-interactive";

const MAX_OUTER_TIMEOUT_MS = 540_000;
// Beyond the per-case solution limit, allow extra wall time for the interactor
// to run + Docker startup overhead on both containers.
const PER_CASE_GRACE_MS = 35_000;

export interface InteractiveExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

function buildContainerArgs(params: {
  containerName: string;
  tempDir: string;
  cpuLimit: string;
  memoryMb: number;
  pidsLimit: number;
  image: string;
}): string[] {
  return [
    "run",
    "-i",
    "--rm",
    "--name",
    params.containerName,
    "--network",
    "none",
    "--user",
    "10001:10001",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "--tmpfs",
    "/workspace:rw,exec,nosuid,nodev,size=128m",
    "-v",
    `${params.tempDir}:/submission:ro`,
    "--cpus",
    params.cpuLimit,
    "--memory",
    `${String(params.memoryMb)}m`,
    "--pids-limit",
    String(params.pidsLimit),
    "--env",
    "HOME=/tmp",
    params.image,
    "node",
    "/runner/index.js",
  ];
}

/** Write the solution container's /submission: student source + config only. */
export async function writeSolutionFiles(
  tempDir: string,
  request: SandboxRequest,
): Promise<void> {
  const fileWrites: Promise<void>[] = [];
  const sourceFileMap: { path: string; key: string }[] = [];
  const defaultSourcePath = sourceFileNames[request.language];
  let wroteDefaultSource = false;

  for (const sourceFile of request.sourceFiles ?? []) {
    const normalizedPath = normalizeRelativePath(sourceFile.path);
    if (!normalizedPath) continue;
    if (normalizedPath === defaultSourcePath) wroteDefaultSource = true;
    const destination = join(tempDir, normalizedPath);
    sourceFileMap.push({ path: normalizedPath, key: normalizedPath });
    fileWrites.push(
      (async () => {
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, sourceFile.content, "utf8");
      })(),
    );
  }

  if (!wroteDefaultSource) {
    fileWrites.push(writeFile(join(tempDir, defaultSourcePath), request.sourceCode, "utf8"));
  }

  const config = {
    ...buildSandboxConfigJson(request, sourceFileMap),
    interactive: { role: "solution" },
  };
  fileWrites.push(writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"));

  await Promise.all(fileWrites);
  await chmod(tempDir, 0o755);
}

/** Write the interactor container's /submission: interactor + one case's secret. */
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

/**
 * Run ONE interactive case across two isolated containers wired by a byte
 * proxy: solution.stdout → interactor.stdin and interactor.stdout →
 * solution.stdin. The secret input/answer is mounted only into the interactor
 * container. Returns the merged per-case result.
 */
async function runCase(
  request: SandboxRequest,
  testcase: SandboxTestcase,
  interactorScript: string,
  interactorLanguage: "python" | "cpp",
  config: InteractiveExecutorConfig,
): Promise<SandboxTestcaseResult> {
  const slug = sanitizeId(request.submissionId).slice(0, 32);
  const solName = `nojv-isol-${slug}-${String(testcase.index)}`;
  const intName = `nojv-iint-${slug}-${String(testcase.index)}`;

  const solDir = await mkdtemp(join(tmpdir(), `nojv-isol-${slug}-`));
  const intDir = await mkdtemp(join(tmpdir(), `nojv-iint-${slug}-`));

  try {
    await Promise.all([
      writeSolutionFiles(solDir, request),
      writeInteractorFiles(intDir, request, testcase, interactorScript, interactorLanguage),
    ]);

    forceRemoveContainerSync(solName);
    forceRemoveContainerSync(intName);

    const outerTimeoutMs = Math.min(
      request.limits.timeoutMs + PER_CASE_GRACE_MS,
      MAX_OUTER_TIMEOUT_MS,
    );

    const { sol, int } = await new Promise<{
      sol: InteractiveSideResult;
      int: InteractiveSideResult;
    }>((resolve) => {
      const solChild = spawn(
        "docker",
        buildContainerArgs({
          containerName: solName,
          tempDir: solDir,
          cpuLimit: config.cpuLimit,
          memoryMb: config.memoryMb,
          pidsLimit: config.pidsLimit,
          image: config.image,
        }),
        { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
      ) as PipedChild;

      const intChild = spawn(
        "docker",
        buildContainerArgs({
          containerName: intName,
          tempDir: intDir,
          cpuLimit: config.cpuLimit,
          memoryMb: config.memoryMb,
          pidsLimit: config.pidsLimit,
          image: config.image,
        }),
        { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
      ) as PipedChild;

      // Cross-wire the live interaction pipe.
      solChild.stdout.pipe(intChild.stdin);
      intChild.stdout.pipe(solChild.stdin);
      // EPIPE is expected when one side exits before the other finishes writing.
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

      const finish = () => {
        if (settled || !solClosed || !intClosed) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          sol: { stderr: solStderr.toString(), timedOut, spawnError: solSpawnError },
          int: { stderr: intStderr.toString(), timedOut, spawnError: intSpawnError },
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        forceRemoveContainer(solName);
        forceRemoveContainer(intName);
        solChild.kill("SIGKILL");
        intChild.kill("SIGKILL");
      }, outerTimeoutMs);

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
        // The solution finished; stop feeding the interactor.
        try {
          intChild.stdin.end();
        } catch {
          // already closed
        }
        finish();
      });
      intChild.on("close", () => {
        intClosed = true;
        try {
          solChild.stdin.end();
        } catch {
          // already closed
        }
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

/**
 * Interactive judging via two isolated containers + a worker byte proxy. The
 * solution and the DOMjudge interactor run in SEPARATE hardened containers; the
 * testcase secret (input/answer) is mounted ONLY into the interactor container,
 * so a student program cannot read it. Cases run sequentially.
 */
export async function runInteractiveMode(
  request: SandboxRequest,
  config: InteractiveExecutorConfig,
): Promise<SandboxResult> {
  const interactorScript = request.judgeConfig.interactorScript;
  if (!interactorScript) {
    return sandboxSystemError("Interactive judge is missing its interactor script.");
  }
  const interactorLanguage =
    request.judgeConfig.interactorLanguage === "cpp"
      ? "cpp"
      : request.judgeConfig.checkerLanguage === "cpp"
        ? "cpp"
        : "python";

  const results: SandboxTestcaseResult[] = [];
  for (const testcase of request.testcases) {
    results.push(
      await runCase(request, testcase, interactorScript, interactorLanguage, config),
    );
  }

  return { testcaseResults: results };
}
