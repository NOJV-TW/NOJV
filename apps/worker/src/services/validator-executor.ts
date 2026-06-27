import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ValidatorOutcome } from "@nojv/core";

import { buildSandboxDockerArgs } from "./docker-args";
import { sanitizeId, spawnDockerContainer } from "./docker-process";
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

export async function runValidator(
  tempDir: string,
  params: ValidatorRunParams,
  config: ValidatorExecutorConfig,
): Promise<Map<number, ValidatorOutcome>> {
  await writeValidatorFiles(tempDir, params);

  const containerName = `nojv-validate-${sanitizeId(params.submissionId).slice(0, 40)}`;
  const args = buildSandboxDockerArgs({
    containerName,
    networkArgs: ["--network", "none"],
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

  const result = await spawnDockerContainer({ args, containerName, outerTimeoutMs });

  const seForAll = (): Map<number, ValidatorOutcome> =>
    new Map(params.cases.map((c): [number, ValidatorOutcome] => [c.index, { verdict: "SE" }]));

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
  for (const c of params.cases) {
    if (!outcomes.has(c.index)) outcomes.set(c.index, { verdict: "SE" });
  }
  return outcomes;
}
