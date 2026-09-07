import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ValidatorOutcome } from "@nojv/core";

import { buildSandboxDockerArgs } from "./docker-args";
import { sanitizeId, spawnDockerContainer } from "./docker-process";
import { buildDockerResourceLabels } from "./docker-resource";
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
  runId: string;
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

  await Promise.all([
    ...fileWrites,
    ...params.cases.flatMap((c) => [
      writeFile(join(tempDir, `case-${String(c.index)}-input.txt`), c.input, "utf8"),
      writeFile(join(tempDir, `case-${String(c.index)}-answer.txt`), c.answer, "utf8"),
      writeFile(join(tempDir, `case-${String(c.index)}-team.txt`), c.teamOutput, "utf8"),
    ]),
  ]);

  await chmod(tempDir, 0o755);
}

export async function runValidator(
  tempDir: string,
  params: ValidatorRunParams,
  signal: AbortSignal,
  config: ValidatorExecutorConfig,
): Promise<Map<number, ValidatorOutcome>> {
  signal.throwIfAborted();
  await writeValidatorFiles(tempDir, params);

  const containerName = `nojv-validate-${sanitizeId(params.runId).slice(0, 40)}`;
  const args = buildSandboxDockerArgs({
    containerName,
    networkArgs: ["--network", "none"],
    tempDir,
    cpuLimit: config.cpuLimit,
    memoryMb: config.memoryMb,
    pidsLimit: config.pidsLimit,
    image: config.image,
    labels: buildDockerResourceLabels(params.runId),
  });

  const outerTimeoutMs = Math.min(
    params.limits.timeoutMs * params.cases.length + 30_000,
    MAX_OUTER_TIMEOUT_MS,
  );

  const result = await spawnDockerContainer({ args, containerName, outerTimeoutMs, signal });

  const seForAll = (judgeMessage: string): Map<number, ValidatorOutcome> =>
    new Map(
      params.cases.map((c): [number, ValidatorOutcome] => [
        c.index,
        { verdict: "SE", judgeMessage },
      ]),
    );

  if (result.spawnError)
    return seForAll(`Validator container failed to start: ${result.spawnError}`);
  if (result.timedOut) return seForAll("Validator container timed out.");
  if (result.exitCode !== 0) {
    return seForAll(
      `Validator container exited with code ${String(result.exitCode)}: ${result.stderr}`,
    );
  }

  let parsed: ReturnType<typeof parseValidateOutput>;
  try {
    parsed = parseValidateOutput(
      JSON.parse(result.stdout),
      params.cases.map(({ index }) => index),
    );
  } catch (error) {
    return seForAll(
      `Invalid validator JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed.success) return seForAll(`Invalid validator output: ${parsed.error.message}`);
  if (parsed.data.compilationError !== undefined) return seForAll(parsed.data.compilationError);
  const reported = parsed.data.validatorOutcomes;
  if (!reported) return seForAll("Validator produced no case outcomes.");

  return new Map(reported.map(({ index, ...outcome }) => [index, outcome]));
}
