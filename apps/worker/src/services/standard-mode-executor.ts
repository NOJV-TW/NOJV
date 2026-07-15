import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  type RawCaseRun,
  type SandboxExecutionContext,
  type SandboxRequest,
  type SandboxResult,
  type ValidatorOutcome,
} from "@nojv/core";

import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { resolveSourceFiles } from "./source-files.js";
import { buildSandboxDockerArgs } from "./docker-args";
import { sanitizeId, spawnDockerContainer, type DockerRunResult } from "./docker-process";
import { buildDockerResourceLabels } from "./docker-resource";
import { runInteractiveMode } from "./interactive-executor";
import { buildSandboxConfigJson, sandboxSystemError } from "./sandbox-plan";
import { parseCompileOutput, parseSandboxResult } from "./sandbox-schema";
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
  execution: SandboxExecutionContext,
  config: StandardModeConfig,
): Promise<SandboxResult> {
  execution.signal.throwIfAborted();
  if (request.judgeType === "interactive") {
    return await runInteractiveMode(request, execution, config);
  }

  const sourceFileMap = await writeSubmissionFiles(tempDir, request);
  const runResult = await runContainer(tempDir, request, execution, config, sourceFileMap);

  if (request.judgeType === "checker" && runResult.rawRuns) {
    return await resolveCheckerResult(request, execution, config, runResult.rawRuns);
  }

  return resolveSandboxResult(runResult, request.testcases, request.judgeConfig.compare);
}

async function resolveCheckerResult(
  request: SandboxRequest,
  execution: SandboxExecutionContext,
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
      ? await runValidatorInTempDir(request, execution, config, {
          runId: execution.runId,
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
  execution: SandboxExecutionContext,
  config: StandardModeConfig,
  params: Parameters<typeof runValidator>[1],
): ReturnType<typeof runValidator> {
  const validateTempDir = await mkdtemp(
    join(tmpdir(), `nojv-validate-${sanitizeId(request.submissionId)}-`),
  );
  try {
    return await runValidator(validateTempDir, params, execution.signal, {
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
): Promise<{ path: string; key: string }[]> {
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

  return sourceFileMap;
}

function caseSystemError(index: number, message: string): RawCaseRun {
  return { index, stdout: "", stderr: message, exitCode: -1, timeMs: 0, errorVerdict: "SE" };
}

function extractCaseRun(phase: DockerRunResult, index: number): RawCaseRun {
  if (phase.spawnError)
    return caseSystemError(index, `Docker failed to start: ${phase.spawnError}`);
  if (phase.timedOut) return caseSystemError(index, "Run container timed out.");
  if (phase.exitCode !== 0) {
    return caseSystemError(
      index,
      `Run container exited with code ${String(phase.exitCode)}.\n${phase.stderr}`.trim(),
    );
  }

  let parsed;
  try {
    parsed = parseSandboxResult(JSON.parse(phase.stdout));
  } catch {
    return caseSystemError(index, `Failed to parse run output.\nstdout: ${phase.stdout}`);
  }
  if (!parsed.success) {
    return caseSystemError(index, `Invalid run output.\nstdout: ${phase.stdout}`);
  }
  const run = parsed.data.rawRuns?.[0];
  if (!run) {
    return caseSystemError(
      index,
      parsed.data.pipelineError ?? "Run container produced no result.",
    );
  }
  return run;
}

async function runContainer(
  tempDir: string,
  request: SandboxRequest,
  execution: SandboxExecutionContext,
  config: StandardModeConfig,
  sourceFileMap: { path: string; key: string }[],
): Promise<SandboxResult> {
  const baseName = sanitizeId(execution.runId).slice(0, 36);
  const networkArgs = ["--network", "none"];
  const baseConfig = buildSandboxConfigJson(request, sourceFileMap);
  const configPath = join(tempDir, "config.json");
  const writeModeConfig = (mode: Record<string, unknown>) =>
    writeFile(configPath, JSON.stringify({ ...baseConfig, mode }), "utf8");

  const artifactDir = await mkdtemp(join(tmpdir(), `nojv-artifact-${baseName}-`));
  await chmod(artifactDir, 0o777);

  try {
    await writeModeConfig({ kind: "compile" });
    const compileName = `nojv-judge-c-${baseName}`;
    const compileArgs = buildSandboxDockerArgs({
      containerName: compileName,
      networkArgs,
      tempDir,
      cpuLimit: config.cpuLimit,
      memoryMb: config.memoryMb,
      pidsLimit: config.pidsLimit,
      image: config.image,
      labels: buildDockerResourceLabels(execution.runId),
      artifactMount: { hostDir: artifactDir, readOnly: false },
    });
    const compile = await spawnDockerContainer({
      args: compileArgs,
      containerName: compileName,
      outerTimeoutMs: MAX_OUTER_TIMEOUT_MS,
      signal: execution.signal,
    });

    if (compile.spawnError) {
      return sandboxSystemError(`Docker failed to start: ${compile.spawnError}`);
    }
    if (compile.timedOut) return sandboxSystemError("Compile phase timed out.");
    if (compile.exitCode !== 0) {
      return sandboxSystemError(
        `Compile container exited with code ${String(compile.exitCode)}.\n${compile.stderr}`.trim(),
      );
    }

    let compileParsed;
    try {
      compileParsed = parseCompileOutput(JSON.parse(compile.stdout));
    } catch {
      return sandboxSystemError(`Failed to parse compile output.\nstdout: ${compile.stdout}`);
    }
    if (!compileParsed.success) {
      return sandboxSystemError(`Invalid compile output.\nstdout: ${compile.stdout}`);
    }
    const compileOut = compileParsed.data;
    if (compileOut.compilationError) {
      return { testcaseResults: [], compilationError: compileOut.compilationError };
    }
    const runCommand = compileOut.runCommand;
    if (!Array.isArray(runCommand) || runCommand.length === 0) {
      return sandboxSystemError("Compile phase returned no run command.");
    }

    const perCaseTimeoutMs = Math.min(
      request.limits.timeoutMs * 2 + 30_000,
      MAX_OUTER_TIMEOUT_MS,
    );
    const rawRuns: RawCaseRun[] = [];
    for (const tc of request.testcases) {
      await writeModeConfig({ kind: "run-case", caseIndex: tc.index, runCommand });
      const caseName = `nojv-judge-r${String(tc.index)}-${baseName}`.slice(0, 60);
      const caseArgs = buildSandboxDockerArgs({
        containerName: caseName,
        networkArgs,
        tempDir,
        cpuLimit: config.cpuLimit,
        memoryMb: config.memoryMb,
        pidsLimit: config.pidsLimit,
        image: config.image,
        labels: buildDockerResourceLabels(execution.runId),
        artifactMount: { hostDir: artifactDir, readOnly: true },
        extraEnv: ["PYTHONDONTWRITEBYTECODE=1"],
      });
      const phase = await spawnDockerContainer({
        args: caseArgs,
        containerName: caseName,
        outerTimeoutMs: perCaseTimeoutMs,
        signal: execution.signal,
      });
      rawRuns.push(extractCaseRun(phase, tc.index));
    }

    return { testcaseResults: [], rawRuns };
  } finally {
    await rm(artifactDir, { recursive: true, force: true });
  }
}
