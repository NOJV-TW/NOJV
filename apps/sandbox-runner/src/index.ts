import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  SandboxInputSchema,
  type SandboxInput,
  type SandboxOutput,
  type ValidateOutput,
} from "./types.js";
import { compile, compileInteractor, sourceFileName } from "./compiler.js";
import {
  cleanupTempDir,
  pathExists,
  readCgroupCpuUsageUsec,
  readCgroupThrottledUsec,
  readCgroupMemoryPeakBytes,
} from "./utils.js";
import { judgeStage } from "./judges/judge-stage.js";
import { runStage } from "./judges/run-stage.js";
import { FrameChannel } from "./judges/interactive-channel.js";
import {
  emitRunReport,
  emitValidateReport,
  runInteractorStage,
  runSolutionStage,
} from "./judges/interactive-stage.js";
import { COMPILATION_TIMEOUT_MS, normalizeRelativePath, validatorTimeoutMs } from "@nojv/core";
import { materializePayload } from "./payload-materializer.js";

const SUBMISSION_DIR = "/submission";
const ARTIFACT_DIR = "/artifact";
const OUTPUT_DIR = "/outputs";
const WORKSPACE_DIR = "/workspace";

function log(message: string): void {
  process.stderr.write(`[sandbox-runner] ${message}\n`);
}

async function readConfig(): Promise<SandboxInput> {
  const raw = await fs.readFile(path.join(SUBMISSION_DIR, "config.json"), "utf-8");
  return SandboxInputSchema.parse(JSON.parse(raw));
}

async function writeWorkFile(
  workDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(workDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function materializeConfiguredSources(
  config: SandboxInput,
  workDir: string,
): Promise<void> {
  for (const sourceFile of config.sourceFiles ?? []) {
    const normalizedPath = normalizeRelativePath(sourceFile.path);
    await writeWorkFile(workDir, normalizedPath, sourceFile.content);
  }

  for (const fileRef of config.sourceFileMap ?? []) {
    const normalizedPath = normalizeRelativePath(fileRef.path);
    const normalizedKey = normalizeRelativePath(fileRef.key);
    const content = await fs.readFile(path.join(SUBMISSION_DIR, normalizedKey), "utf-8");
    await writeWorkFile(workDir, normalizedPath, content);
  }
}

async function findScript(prefix: string): Promise<string | null> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const match = entries.find((e) => e.startsWith(`${prefix}.`));
  return match ? path.join(SUBMISSION_DIR, match) : null;
}

function emit(overrides: Partial<SandboxOutput>): void {
  const output: SandboxOutput = {
    testcaseResults: [],
    ...overrides,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function emitValidate(output: ValidateOutput): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function compileSubmission(
  workDir: string,
  config: SandboxInput,
): Promise<ReturnType<typeof compile>> {
  await materializeConfiguredSources(config, workDir);

  const defaultEntry = sourceFileName(config.language);
  const entryFile = config.entryFile ? normalizeRelativePath(config.entryFile) : defaultEntry;
  const srcFile = path.join(workDir, entryFile);

  if (!(await pathExists(srcFile))) {
    log("Reading source code...");
    const rawSource = await fs.readFile(path.join(SUBMISSION_DIR, entryFile), "utf-8");
    await writeWorkFile(workDir, entryFile, rawSource);
  }

  log("Compiling...");
  return compile(config, srcFile, workDir);
}

async function runInteractive(workDir: string, config: SandboxInput): Promise<void> {
  const { interactive } = config;
  if (!interactive) throw new Error("runInteractive called without an interactive config.");
  const channel = new FrameChannel(process.stdin, process.stdout);

  if (interactive.role === "solution") {
    const compileResult = await compileSubmission(workDir, config);
    if (!compileResult.success) {
      emitRunReport({ exitCode: -1, timeMs: 0, compilationError: compileResult.error });
      return;
    }
    const [cmd, ...args] = compileResult.runCommand;
    if (!cmd) throw new Error("Compilation produced an empty run command.");
    try {
      await channel.ready(COMPILATION_TIMEOUT_MS);
    } catch (error) {
      emitRunReport({
        exitCode: -1,
        timeMs: 0,
        errorVerdict: "SE",
        stderr: `Interactive startup failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
      return;
    }
    await runSolutionStage({
      runCommand: [cmd, ...args],
      cases: interactive.cases,
      timeoutMs: config.limits.timeoutMs,
      memoryLimitMb: config.limits.memoryMb,
      ...(config.limits.env ? { env: config.limits.env } : {}),
      workspaceDir: WORKSPACE_DIR,
      channel,
    });
    return;
  }

  const seAll = (judgeMessage: string) => {
    for (const index of interactive.cases)
      emitValidateReport({ index, verdict: "SE", judgeMessage });
  };
  const interactorPath = await findScript("interactor");
  if (!interactorPath) {
    seAll("Interactive validator requires an interactor script.");
    return;
  }
  log("Compiling interactor...");
  const compiled = await compileInteractor(interactorPath, interactive.language, workDir);
  if (!compiled.success) {
    seAll(`Interactor compilation failed: ${compiled.error}`);
    return;
  }
  const [cmd, ...args] = compiled.runCommand;
  if (!cmd) throw new Error("Interactor compilation produced an empty run command.");
  try {
    await channel.ready(COMPILATION_TIMEOUT_MS);
  } catch (error) {
    seAll(
      `Interactive startup failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return;
  }
  await runInteractorStage({
    interactorCommand: [cmd, ...args],
    cases: interactive.cases,
    timeoutMs: validatorTimeoutMs(config.limits.timeoutMs),
    submissionDir: SUBMISSION_DIR,
    workDir,
    channel,
  });
}

async function runStagePhase(config: SandboxInput): Promise<void> {
  if (config.mode?.kind !== "run-stage") {
    emit({ pipelineError: "run-stage phase requires a run-stage mode." });
    return;
  }
  const compileResult = await compileSubmission(ARTIFACT_DIR, config);
  if (!compileResult.success) {
    process.stdout.write(`${JSON.stringify({ compilationError: compileResult.error })}\n`);
    return;
  }
  const [cmd, ...args] = compileResult.runCommand;
  if (!cmd) {
    emit({ pipelineError: "Compilation produced an empty run command." });
    return;
  }
  const rawRuns = await runStage({
    runCommand: [cmd, ...args],
    caseIndices: config.mode.caseIndices,
    parallelism: config.mode.parallelism,
    timeoutMs: config.limits.timeoutMs,
    memoryLimitMb: config.limits.memoryMb,
    ...(config.limits.env ? { env: config.limits.env } : {}),
    submissionDir: SUBMISSION_DIR,
    workspaceDir: WORKSPACE_DIR,
    ...((await pathExists(OUTPUT_DIR)) ? { outputDir: OUTPUT_DIR } : {}),
  });
  emit({ rawRuns });
}

async function judgeStagePhase(config: SandboxInput): Promise<void> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "judge-"));
  try {
    emitValidate(
      await judgeStage({
        config,
        submissionDir: SUBMISSION_DIR,
        outputDir: OUTPUT_DIR,
        artifactDir: ARTIFACT_DIR,
        workDir,
      }),
    );
  } finally {
    await cleanupTempDir(workDir);
  }
}

async function main(): Promise<void> {
  if (
    process.env.SANDBOX_PHASE === "run-stage" ||
    process.env.SANDBOX_PHASE === "judge-stage"
  ) {
    await materializePayload({ payloadDir: "/payload", submissionDir: SUBMISSION_DIR });
  }
  if (process.env.SANDBOX_PHASE === "materialize") {
    await materializePayload({ payloadDir: "/payload", submissionDir: SUBMISSION_DIR });
    return;
  }

  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.problemType}`,
  );

  const phase = process.env.SANDBOX_PHASE ?? config.mode?.kind;

  if (phase === "run-stage") {
    await runStagePhase(config);
    return;
  }
  if (phase === "judge-stage") {
    await judgeStagePhase(config);
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  try {
    if (config.interactive) {
      try {
        await runInteractive(workDir, config);
      } finally {
        process.stdin.destroy();
      }
    } else {
      emit({
        pipelineError: "no phase specified (expected run-stage, judge-stage or interactive).",
      });
    }
  } finally {
    await cleanupTempDir(workDir);
  }
}

const initialCpuUsec = readCgroupCpuUsageUsec();
const initialThrottledUsec = readCgroupThrottledUsec();
try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[sandbox-runner] Fatal error: ${message}\n`);

  const output: SandboxOutput = {
    testcaseResults: [
      {
        index: 0,
        verdict: "SE",
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
      },
    ],
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 1;
} finally {
  const cpu = readCgroupCpuUsageUsec();
  const throttled = readCgroupThrottledUsec();
  process.stderr.write(
    `\n${JSON.stringify({
      nojvResourceUsage: {
        cpuUsec:
          cpu !== null && initialCpuUsec !== null ? Math.max(0, cpu - initialCpuUsec) : null,
        throttledUsec:
          throttled !== null && initialThrottledUsec !== null
            ? Math.max(0, throttled - initialThrottledUsec)
            : null,
        memoryPeakBytes: readCgroupMemoryPeakBytes(),
      },
    })}\n`,
  );
}
