import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RawCaseRun } from "@nojv/core";
import { readTestcase } from "../testcase-files.js";
import { runSolution } from "./standard.js";
import { writeCaseOutput, writeStageRuns, type StageRunRecord } from "./stage-files.js";

const DISPLAY_CHARS = 64 * 1024;
const TAMPERED =
  "Isolation violation: the program changed files outside its working directory, so the remaining cases were not run.";

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
  protectedDirs?: string[];
  scratchDirs?: string[];
}

async function fingerprint(dirs: string[]): Promise<string> {
  const entries: string[] = [];
  async function walk(target: string): Promise<void> {
    const stat = await fs.lstat(target, { bigint: true });
    entries.push([target, stat.ino, stat.mode, stat.nlink, stat.size, stat.ctimeNs].join("\0"));
    if (stat.isDirectory())
      for (const name of (await fs.readdir(target)).sort()) await walk(path.join(target, name));
  }
  for (const dir of dirs) await walk(dir);
  return entries.join("\n");
}

async function clearDir(dir: string): Promise<void> {
  for (const name of await fs.readdir(dir)) {
    const target = path.join(dir, name);
    await fs.rm(target, { recursive: true, force: true }).catch(async () => {
      await unlock(target);
      await fs.rm(target, { recursive: true, force: true });
    });
  }
}

async function unlock(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory()) return;
  await fs.chmod(target, 0o700);
  for (const name of await fs.readdir(target)) await unlock(path.join(target, name));
}

export async function runStage(params: RunStageParams): Promise<RawCaseRun[]> {
  const runs = new Map<number, RawCaseRun>();
  const records: StageRunRecord[] = [];
  const queue = [...params.caseIndices];
  const guarded = params.parallelism <= 1 && Boolean(params.protectedDirs?.length);
  let tampered = false;

  async function runNext(): Promise<void> {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      if (tampered) {
        runs.set(index, {
          index,
          stdout: "",
          stderr: TAMPERED,
          exitCode: 1,
          timeMs: 0,
          errorVerdict: "RE",
        });
        continue;
      }
      const scratch = await fs.mkdtemp(
        path.join(params.workspaceDir, `case-${String(index)}-`),
      );
      try {
        const testcase = await readTestcase(params.submissionDir, index);
        const before = guarded ? await fingerprint(params.protectedDirs ?? []) : "";
        let run = await runSolution(
          params.runCommand,
          testcase,
          params.timeoutMs,
          params.memoryLimitMb,
          { HOME: scratch, TMPDIR: scratch, ...params.env },
          scratch,
        );
        if (guarded) {
          const cleared = await Promise.all((params.scratchDirs ?? []).map(clearDir)).then(
            () => true,
            () => false,
          );
          if (!cleared || (await fingerprint(params.protectedDirs ?? [])) !== before) {
            tampered = true;
            run = { ...run, stdout: "", stderr: TAMPERED, errorVerdict: "RE" };
          }
        }
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
