import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  type RawCaseRun,
  type SandboxRequest,
  type SandboxResult,
  type ValidatorOutcome,
} from "@nojv/core";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { resolveSourceFiles } from "./source-files.js";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { runInteractiveMode } from "./interactive-executor";
import { buildSandboxConfigJson, sandboxSystemError } from "./sandbox-plan";
import { parseSandboxResult } from "./sandbox-schema";
import { runValidator, type ValidatorCase } from "./validator-executor";

const MAX_OUTER_TIMEOUT_MS = 540_000;

export interface StandardModeConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

export async function runStandardMode(
  tempDir: string,
  request: SandboxRequest,
  config: StandardModeConfig,
): Promise<SandboxResult> {
  if (request.judgeType === "interactive") {
    return await runInteractiveMode(request, config);
  }

  await writeSubmissionFiles(tempDir, request);
  const runResult = await runContainer(tempDir, request, config);

  if (request.judgeType === "checker" && runResult.rawRuns) {
    return await resolveCheckerResult(request, config, runResult.rawRuns);
  }

  return resolveSandboxResult(runResult, request.testcases);
}

async function resolveCheckerResult(
  request: SandboxRequest,
  config: StandardModeConfig,
  rawRuns: RawCaseRun[],
): Promise<SandboxResult> {
  const validatorScript = request.judgeConfig.checkerScript;
  if (!validatorScript) {
    return sandboxSystemError("Checker judge is missing its validator script.");
  }

  const validatorLanguage = request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";

  const testcaseByIndex = new Map(request.testcases.map((tc) => [tc.index, tc]));

  const cases: ValidatorCase[] = [];
  for (const run of rawRuns) {
    if (run.errorVerdict) continue;
    const tc = testcaseByIndex.get(run.index);
    if (tc?.output === undefined) continue;
    cases.push({
      index: run.index,
      input: tc.input,
      answer: tc.output,
      teamOutput: run.stdout,
    });
  }

  const outcomes =
    cases.length > 0
      ? await runValidatorInTempDir(request, config, {
          submissionId: request.submissionId,
          validatorScript,
          validatorLanguage,
          cases,
          limits: { timeoutMs: request.limits.timeoutMs, memoryMb: request.limits.memoryMb },
        })
      : new Map<number, ValidatorOutcome>();

  return { testcaseResults: mergeCheckerResults(rawRuns, outcomes) };
}

async function runValidatorInTempDir(
  request: SandboxRequest,
  config: StandardModeConfig,
  params: Parameters<typeof runValidator>[1],
): ReturnType<typeof runValidator> {
  const validateTempDir = await mkdtemp(
    join(tmpdir(), `nojv-validate-${sanitizeId(request.submissionId)}-`),
  );
  try {
    return await runValidator(validateTempDir, params, {
      cpuLimit: config.cpuLimit,
      image: config.image,
      memoryMb: config.memoryMb,
      pidsLimit: config.pidsLimit,
    });
  } finally {
    await rm(validateTempDir, { force: true, recursive: true });
  }
}

export async function writeSubmissionFiles(
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
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, sf.content, "utf8");
      })(),
    );
  }

  fileWrites.push(
    writeFile(
      join(tempDir, "config.json"),
      JSON.stringify(buildSandboxConfigJson(request, sourceFileMap)),
      "utf8",
    ),
  );

  await Promise.all(fileWrites);

  const testcasesDir = join(tempDir, "testcases");
  await mkdir(testcasesDir, { recursive: true });

  await Promise.all(
    request.testcases.map(async (tc) => {
      const tcDir = join(testcasesDir, String(tc.index));
      await mkdir(tcDir, { recursive: true });
      await writeFile(join(tcDir, "input.txt"), tc.input, "utf8");
    }),
  );

  await mkdir(join(tempDir, "artifacts"), { recursive: true });

  await chmod(tempDir, 0o755);
}

export interface StandardDockerArgsParams {
  containerName: string;
  networkArgs: string[];
  tempDir: string;
  cpuLimit: string;
  memoryMb: number;
  pidsLimit: number;
  image: string;
}

export function buildStandardDockerArgs(params: StandardDockerArgsParams): string[] {
  return [
    "run",
    "--rm",
    "--name",
    params.containerName,
    ...params.networkArgs,
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
    "--memory-swap",
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

async function runContainer(
  tempDir: string,
  request: SandboxRequest,
  config: StandardModeConfig,
): Promise<SandboxResult> {
  const containerName = `nojv-judge-${sanitizeId(request.submissionId).slice(0, 40)}`;

  const networkArgs = ["--network", "none"];

  const args = buildStandardDockerArgs({
    containerName,
    networkArgs,
    tempDir,
    cpuLimit: config.cpuLimit,
    memoryMb: config.memoryMb,
    pidsLimit: config.pidsLimit,
    image: config.image,
  });

  const outerTimeoutMs = Math.min(
    request.limits.timeoutMs * 2 * request.testcases.length + 30_000,
    MAX_OUTER_TIMEOUT_MS,
  );

  forceRemoveContainerSync(containerName);

  return await new Promise<SandboxResult>((resolve) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });

    const stdoutBuf = createBoundedStringBuffer();
    const stderrBuf = createBoundedStringBuffer();
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
      stdoutBuf.push(chunk);
    });

    child.stderr.on("data", (chunk: string) => {
      stderrBuf.push(chunk);
    });

    child.on("error", (error: Error) => {
      clearTimeout(timer);
      settle(sandboxSystemError(`Docker failed to start: ${error.message}`));
    });

    child.on("close", (exitCode: number | null) => {
      clearTimeout(timer);

      const stdout = stdoutBuf.toString();
      const stderr = stderrBuf.toString();

      if (timedOut) {
        settle(sandboxSystemError("Sandbox execution timed out."));
        return;
      }

      if (exitCode !== 0) {
        settle(
          sandboxSystemError(`Sandbox exited with code ${String(exitCode)}.\n${stderr}`.trim()),
        );
        return;
      }

      try {
        const parsed = parseSandboxResult(JSON.parse(stdout));
        settle(
          parsed.success
            ? parsed.data
            : sandboxSystemError(
                `Failed to parse sandbox output.\nstdout: ${stdout}\nstderr: ${stderr}`,
              ),
        );
      } catch {
        settle(
          sandboxSystemError(
            `Failed to parse sandbox output.\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }
    });

    child.stdin.end();
  });
}
