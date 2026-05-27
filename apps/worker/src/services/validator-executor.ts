import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ValidatorOutcome } from "@nojv/core";

import { createBoundedStringBuffer } from "./bounded-buffer";
import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";
import { sourceExtension } from "./sandbox-plan";
import { parseValidateOutput } from "./sandbox-schema";

const MAX_OUTER_TIMEOUT_MS = 540_000;

export interface ValidatorCase {
  index: number;
  input: string;
  answer: string;
  teamOutput: string;
}

export interface ValidatorRunParams {
  submissionId: string;
  validatorScript: string;
  validatorLanguage: "python" | "cpp";
  cases: ValidatorCase[];
  limits: { timeoutMs: number; memoryMb: number };
}

export interface ValidatorExecutorConfig {
  cpuLimit: string;
  image: string;
  memoryMb: number;
  pidsLimit: number;
}

export interface ValidatorDockerArgsParams {
  containerName: string;
  tempDir: string;
  cpuLimit: string;
  memoryMb: number;
  pidsLimit: number;
  image: string;
}

export function buildValidatorDockerArgs(params: ValidatorDockerArgsParams): string[] {
  return [
    "run",
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

export async function writeValidatorFiles(
  tempDir: string,
  params: ValidatorRunParams,
): Promise<void> {
  const ext = sourceExtension(params.validatorLanguage);

  const config = {
    submissionId: params.submissionId,
    language: "python",
    judgeType: "checker",
    problemType: "full_source",
    limits: params.limits,
    validate: {
      language: params.validatorLanguage,
      cases: params.cases.map((c) => ({ index: c.index })),
    },
  };

  const fileWrites: Promise<void>[] = [
    writeFile(join(tempDir, `validator.${ext}`), params.validatorScript, "utf8"),
    writeFile(join(tempDir, "config.json"), JSON.stringify(config), "utf8"),
  ];

  const casesDir = join(tempDir, "cases");
  await mkdir(casesDir, { recursive: true });

  await Promise.all([
    ...fileWrites,
    ...params.cases.map(async (c) => {
      const caseDir = join(casesDir, String(c.index));
      await mkdir(caseDir, { recursive: true });
      await Promise.all([
        writeFile(join(caseDir, "input.txt"), c.input, "utf8"),
        writeFile(join(caseDir, "answer.txt"), c.answer, "utf8"),
        writeFile(join(caseDir, "team.txt"), c.teamOutput, "utf8"),
      ]);
    }),
  ]);

  await chmod(tempDir, 0o755);
}

/**
 * Run the DOMjudge output validator over the solution's captured per-case
 * output in a SECOND, isolated container. Student code is never present here —
 * only the validator source and the case input/answer/team files. Returns a
 * `ValidatorOutcome` per case keyed by `index`. Any container/system failure
 * surfaces as an SE outcome for every requested case.
 */
export async function runValidator(
  tempDir: string,
  params: ValidatorRunParams,
  config: ValidatorExecutorConfig,
): Promise<Map<number, ValidatorOutcome>> {
  await writeValidatorFiles(tempDir, params);

  const containerName = `nojv-validate-${sanitizeId(params.submissionId).slice(0, 40)}`;
  const args = buildValidatorDockerArgs({
    containerName,
    tempDir,
    cpuLimit: config.cpuLimit,
    memoryMb: config.memoryMb,
    pidsLimit: config.pidsLimit,
    image: config.image,
  });

  const outerTimeoutMs = Math.min(
    params.limits.timeoutMs * params.cases.length + 30_000,
    MAX_OUTER_TIMEOUT_MS,
  );

  forceRemoveContainerSync(containerName);

  const result = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
    const stdoutBuf = createBoundedStringBuffer();
    const stderrBuf = createBoundedStringBuffer();
    let timedOut = false;
    let settled = false;

    const settle = (value: {
      exitCode: number | null;
      stdout: string;
      stderr: string;
      timedOut: boolean;
    }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      forceRemoveContainer(containerName);
      child.kill("SIGKILL");
    }, outerTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdoutBuf.push(chunk));
    child.stderr.on("data", (chunk: string) => stderrBuf.push(chunk));

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      settle({
        exitCode: null,
        stdout: "",
        stderr: `spawn failed: ${err.message}`,
        timedOut: false,
      });
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      settle({
        exitCode: code,
        stdout: stdoutBuf.toString(),
        stderr: stderrBuf.toString(),
        timedOut,
      });
    });

    child.stdin.end();
  });

  const seForAll = (): Map<number, ValidatorOutcome> =>
    new Map(params.cases.map((c) => [c.index, { verdict: "SE" } as ValidatorOutcome]));

  if (result.timedOut || result.exitCode !== 0) return seForAll();

  let parsed: ReturnType<typeof parseValidateOutput>;
  try {
    parsed = parseValidateOutput(JSON.parse(result.stdout));
  } catch {
    return seForAll();
  }
  if (!parsed.success || parsed.data.validatorOutcomes === undefined) return seForAll();

  const outcomes = new Map<number, ValidatorOutcome>();
  for (const o of parsed.data.validatorOutcomes) {
    const { index, ...outcome } = o;
    outcomes.set(index, outcome);
  }
  // Any case the validator failed to report on is an SE for that case.
  for (const c of params.cases) {
    if (!outcomes.has(c.index)) outcomes.set(c.index, { verdict: "SE" });
  }
  return outcomes;
}
