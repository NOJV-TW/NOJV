import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMPILATION_TIMEOUT_MS,
  type SandboxExecutionContext,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";

import { resolveSourceFiles } from "../shared/source-files.js";
import { buildSandboxDockerArgs } from "./args";
import { sanitizeId, spawnDockerContainer, type DockerRunResult } from "./process";
import { buildDockerResourceLabels } from "./resource";
import { runInteractiveMode } from "./interactive-executor";
import { buildSandboxConfigJson } from "../shared/sandbox-plan";
import {
  buildJudgePayload,
  completeRuns,
  gradableRuns,
  judgeFailedForAll,
  mergeStageResults,
  parseCompilationError,
  parseJudgeOutcomes,
  parseRunResult,
} from "../shared/stage-result";

const MAX_OUTER_TIMEOUT_MS = 540_000;
const JUDGE_TIMEOUT_MS = 300_000;

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
  return await runStageContainers(tempDir, request, execution, config, sourceFileMap);
}

export async function writeSubmissionFiles(
  tempDir: string,
  request: SandboxRequest,
): Promise<{ path: string; key: string }[]> {
  const fileWrites: Promise<void>[] = [];
  const sourceFileMap: { path: string; key: string }[] = [];

  for (const sf of resolveSourceFiles(request)) {
    const key = `source-file-${String(sourceFileMap.length)}`;
    sourceFileMap.push({ path: sf.path, key });
    fileWrites.push(writeFile(join(tempDir, key), sf.content, "utf8"));
  }

  await Promise.all(fileWrites);

  await Promise.all(
    request.testcases.map((tc) =>
      writeFile(join(tempDir, `testcase-${String(tc.index)}-input.txt`), tc.input, "utf8"),
    ),
  );

  await mkdir(join(tempDir, "artifacts"), { recursive: true });

  await chmod(tempDir, 0o755);

  return sourceFileMap;
}

function containerFailure(phase: DockerRunResult, name: string): string | null {
  if (phase.spawnError) return `Docker failed to start: ${phase.spawnError}`;
  if (phase.timedOut) return `${name} container timed out.`;
  if (phase.exitCode !== 0)
    return `${name} container exited with code ${String(phase.exitCode)}.\n${phase.stderr}`.trim();
  return null;
}

async function makeSharedDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await chmod(dir, 0o777);
  return dir;
}

async function runStageContainers(
  tempDir: string,
  request: SandboxRequest,
  execution: SandboxExecutionContext,
  config: StandardModeConfig,
  sourceFileMap: { path: string; key: string }[],
): Promise<SandboxResult> {
  const baseName = sanitizeId(execution.runId).slice(0, 36);
  const networkArgs = ["--network", "none"];
  const labels = buildDockerResourceLabels(execution.runId);
  const baseConfig = buildSandboxConfigJson(request, sourceFileMap);
  const writeModeConfig = (mode: Record<string, unknown>) =>
    writeFile(join(tempDir, "config.json"), JSON.stringify({ ...baseConfig, mode }), "utf8");
  const containerArgs = (
    containerName: string,
    submissionDir: string,
    mounts: Pick<
      Parameters<typeof buildSandboxDockerArgs>[0],
      "artifactMount" | "outputsMount"
    >,
  ) =>
    buildSandboxDockerArgs({
      containerName,
      networkArgs,
      tempDir: submissionDir,
      cpuLimit: config.cpuLimit,
      memoryMb: config.memoryMb,
      pidsLimit: config.pidsLimit,
      image: config.image,
      labels,
      extraEnv: ["PYTHONDONTWRITEBYTECODE=1"],
      ...mounts,
    });

  const artifactDir = await makeSharedDir(`nojv-artifact-${baseName}-`);
  const outputDir = await makeSharedDir(`nojv-outputs-${baseName}-`);
  const judgeDir = await mkdtemp(join(tmpdir(), `nojv-judge-${baseName}-`));
  const judgeArtifactDir = await makeSharedDir(`nojv-judge-artifact-${baseName}-`);

  try {
    await writeModeConfig({
      kind: "run-stage",
      caseIndices: request.testcases.map((tc) => tc.index),
      parallelism: 1,
    });
    const runName = `nojv-judge-r-${baseName}`;
    const runPhase = await spawnDockerContainer({
      args: containerArgs(runName, tempDir, {
        artifactMount: { hostDir: artifactDir, readOnly: false },
        outputsMount: { hostDir: outputDir, readOnly: false },
      }),
      containerName: runName,
      outerTimeoutMs: Math.min(
        COMPILATION_TIMEOUT_MS +
          (request.limits.timeoutMs * 2 + 5_000) * Math.max(1, request.testcases.length) +
          30_000,
        MAX_OUTER_TIMEOUT_MS,
      ),
      signal: execution.signal,
    });
    const runFailure = containerFailure(runPhase, "Run");
    const compilationError = runFailure ? null : parseCompilationError(runPhase.stdout);
    if (compilationError) return { testcaseResults: [], compilationError };
    const run = runFailure ? null : parseRunResult(runPhase.stdout);
    const rawRuns = completeRuns(
      request,
      run?.rawRuns ?? [],
      runFailure ?? run?.pipelineError ?? "Run container produced no result.",
    );
    const gradable = gradableRuns(request, rawRuns);
    if (gradable.length === 0) return mergeStageResults(request, rawRuns, new Map());

    await Promise.all(
      Object.entries(buildJudgePayload(request)).map(([file, content]) =>
        writeFile(join(judgeDir, file), content, "utf8"),
      ),
    );
    await chmod(judgeDir, 0o755);
    const judgeName = `nojv-judge-j-${baseName}`;
    const judge = await spawnDockerContainer({
      args: containerArgs(judgeName, judgeDir, {
        artifactMount: { hostDir: judgeArtifactDir, readOnly: false },
        outputsMount: { hostDir: outputDir, readOnly: true },
      }),
      containerName: judgeName,
      outerTimeoutMs: JUDGE_TIMEOUT_MS,
      signal: execution.signal,
    });
    const judgeFailure = containerFailure(judge, "Judge");
    return mergeStageResults(
      request,
      rawRuns,
      judgeFailure
        ? judgeFailedForAll(gradable, judgeFailure)
        : parseJudgeOutcomes(judge.stdout, gradable),
    );
  } finally {
    await Promise.all(
      [artifactDir, outputDir, judgeDir, judgeArtifactDir].map((dir) =>
        rm(dir, { recursive: true, force: true }),
      ),
    );
  }
}
