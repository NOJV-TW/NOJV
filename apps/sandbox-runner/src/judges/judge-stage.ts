import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  compareStandard,
  validatorTimeoutMs,
  type ValidateOutput,
  type ValidatorCaseOutcome,
} from "@nojv/core";
import { compileValidator } from "../compiler.js";
import type { SandboxInput } from "../types.js";
import { findScript, pathExists } from "../utils.js";
import { readCaseOutput, readStageRuns } from "./stage-files.js";
import { validateCase } from "./validate.js";

export interface JudgeStageParams {
  config: SandboxInput;
  submissionDir: string;
  outputDir: string;
  artifactDir: string;
  workDir: string;
}

export async function judgeStage(params: JudgeStageParams): Promise<ValidateOutput> {
  const { config, submissionDir } = params;
  let validatorCommand: string[] | null = null;
  if (config.validate) {
    const script = await findScript(submissionDir, "validator");
    if (!script) return { compilationError: "Checker judge requires a validator script." };
    const compiled = await compileValidator(
      script,
      config.validate.language,
      params.artifactDir,
    );
    if (!compiled.success)
      return { compilationError: `Validator compilation failed: ${compiled.error}` };
    validatorCommand = compiled.runCommand;
  }

  const validatorOutcomes: ValidatorCaseOutcome[] = [];
  for (const record of await readStageRuns(params.outputDir)) {
    const inputFile = path.join(submissionDir, `case-${String(record.index)}-input.txt`);
    const answerFile = path.join(submissionDir, `case-${String(record.index)}-answer.txt`);
    if (!(await pathExists(answerFile))) continue;
    const teamOutput = await readCaseOutput(params.outputDir, record);
    if (teamOutput === null) {
      validatorOutcomes.push({
        index: record.index,
        verdict: "WA",
        judgeMessage: "The case output changed after its run finished.",
      });
    } else if (validatorCommand) {
      const feedbackDir = await fs.mkdtemp(
        path.join(params.workDir, `fb-${String(record.index)}-`),
      );
      validatorOutcomes.push(
        await validateCase(
          validatorCommand,
          { inputFile, answerFile, teamOutput },
          feedbackDir,
          record.index,
          validatorTimeoutMs(config.limits.timeoutMs),
        ),
      );
    } else {
      const answer = await fs.readFile(answerFile, "utf8");
      validatorOutcomes.push({
        index: record.index,
        verdict: compareStandard(teamOutput, answer, config.compare ?? undefined) ? "AC" : "WA",
      });
    }
  }
  return { validatorOutcomes };
}
