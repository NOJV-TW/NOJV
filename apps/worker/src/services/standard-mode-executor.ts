import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  normalizeRelativePath,
  sourceFileNames,
  type RawCaseRun,
  type SandboxRequest,
  type SandboxResult,
  type ValidatorOutcome,
} from "@nojv/core";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { buildSandboxConfigJson, sandboxSystemError, sourceExtension } from "./sandbox-plan";
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
  await writeSubmissionFiles(tempDir, request);
  const runResult = await runContainer(tempDir, request, config);

  // Checker mode: the run container only produced raw output. Run the
  // DOMjudge validator in a SECOND isolated container, then merge.
  if (request.judgeType === "checker" && runResult.rawRuns) {
    return await resolveCheckerResult(request, config, runResult.rawRuns);
  }

  // Standard mode emits rawRuns → worker compares; checker/interactive that
  // reached here without rawRuns already carry testcaseResults.
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

  // Only clean runs go to the validator; failed runs (TLE/MLE/RE/SE) pass
  // through. A clean run whose testcase has no expected answer is a
  // misconfiguration → its outcome is left absent so the merge marks it SE.
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
      })(),
    );
  }

  if (!wroteDefaultSource) {
    fileWrites.push(writeFile(join(tempDir, defaultSourcePath), request.sourceCode, "utf8"));
  }

  fileWrites.push(
    writeFile(
      join(tempDir, "config.json"),
      JSON.stringify(buildSandboxConfigJson(request, sourceFileMap)),
      "utf8",
    ),
  );

  // Checker mode no longer runs an in-container checker: the validator runs
  // in a SECOND isolated container (see runValidator). The checker script must
  // never enter the run container alongside student code.

  if (request.judgeConfig.interactorScript) {
    const ext = sourceExtension(request.judgeConfig.interactorLanguage);
    fileWrites.push(
      writeFile(
        join(tempDir, `interactor.${ext}`),
        request.judgeConfig.interactorScript,
        "utf8",
      ),
    );
  }

  await Promise.all(fileWrites);

  const testcasesDir = join(tempDir, "testcases");
  await mkdir(testcasesDir, { recursive: true });

  // Standard and checker modes run the solution in this container but decide
  // the verdict elsewhere (worker comparison / isolated validator container).
  // The expected answer must never be readable from inside the run container —
  // a student program could otherwise just echo it back. Interactive keeps its
  // existing in-container layout unchanged (it ignores expected.txt anyway).
  const shipExpected = request.judgeType !== "standard" && request.judgeType !== "checker";

  await Promise.all(
    request.testcases.map(async (tc) => {
      const tcDir = join(testcasesDir, String(tc.index));
      await mkdir(tcDir, { recursive: true });
      await writeFile(join(tcDir, "input.txt"), tc.input, "utf8");

      if (shipExpected && tc.output !== undefined) {
        await writeFile(join(tcDir, "expected.txt"), tc.output, "utf8");
      }
    }),
  );

  // Create artifacts directory
  await mkdir(join(tempDir, "artifacts"), { recursive: true });

  // Make all files readable by the container's non-root user
  await chmod(tempDir, 0o755);
}

async function runContainer(
  tempDir: string,
  request: SandboxRequest,
  config: StandardModeConfig,
): Promise<SandboxResult> {
  const containerName = `nojv-judge-${sanitizeId(request.submissionId).slice(0, 40)}`;

  // All containers — standard and advanced — run with
  // `--network=none`. Student submissions must never reach the
  // network. Advanced mode has its own launch path in
  // `runAdvancedContainer` but enforces the same flag.
  const networkArgs = ["--network", "none"];

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    ...networkArgs,
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
    `${tempDir}:/submission:ro`,
    "--cpus",
    config.cpuLimit,
    "--memory",
    `${String(config.memoryMb)}m`,
    "--pids-limit",
    String(config.pidsLimit),
    "--env",
    "HOME=/tmp",
    config.image,
    "node",
    "/runner/index.js",
  ];

  // Outer timeout: container timeout + 30s grace for Docker overhead
  const outerTimeoutMs = Math.min(
    request.limits.timeoutMs * request.testcases.length + 30_000,
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
