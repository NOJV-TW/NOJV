import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RawCaseRun } from "@nojv/core";
import { readTestcase } from "../testcase-files.js";
import { runSolution } from "./standard.js";
import { writeCaseOutput, writeStageRuns, type StageRunRecord } from "./stage-files.js";

const DISPLAY_CHARS = 64 * 1024;

export interface RunStageParams {
  runCommand: string[];
  caseIndices: number[];
  parallelism: number;
  timeoutMs: number;
  memoryLimitMb: number;
  env?: Record<string, string>;
  submissionDir: string;
  workspaceDir: string;
  outputDir?: string;
}

export async function runStage(params: RunStageParams): Promise<RawCaseRun[]> {
  const runs = new Map<number, RawCaseRun>();
  const records: StageRunRecord[] = [];
  const queue = [...params.caseIndices];

  async function runNext(): Promise<void> {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      const scratch = await fs.mkdtemp(
        path.join(params.workspaceDir, `case-${String(index)}-`),
      );
      try {
        const testcase = await readTestcase(params.submissionDir, index);
        const run = await runSolution(
          params.runCommand,
          testcase,
          params.timeoutMs,
          params.memoryLimitMb,
          { HOME: scratch, TMPDIR: scratch, ...params.env },
          scratch,
        );
        if (params.outputDir && !run.errorVerdict)
          records.push(await writeCaseOutput(params.outputDir, index, run.stdout));
        runs.set(index, {
          ...run,
          stdout: run.stdout.slice(0, DISPLAY_CHARS),
          stderr: run.stderr.slice(0, DISPLAY_CHARS),
        });
      } finally {
        await fs.rm(scratch, { recursive: true, force: true });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(params.parallelism, queue.length)) }, runNext),
  );
  if (params.outputDir)
    await writeStageRuns(
      params.outputDir,
      records.sort((a, b) => a.index - b.index),
    );
  return params.caseIndices.flatMap((index) => runs.get(index) ?? []);
}
