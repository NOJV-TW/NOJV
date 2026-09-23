import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MAX_EXECUTION_OUTPUT_BYTES } from "@nojv/core";
import { z } from "zod";

const STAGE_RUNS_FILE = "runs.json";

const stageRunsSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);

export type StageRunRecord = z.infer<typeof stageRunsSchema>[number];

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function caseOutputFile(outputDir: string, index: number): string {
  return path.join(outputDir, `case-${String(index)}.out`);
}

async function replaceFile(target: string, content: string): Promise<void> {
  const temp = `${target}.${randomUUID()}`;
  await fs.writeFile(temp, content, { flag: "wx", mode: 0o600 });
  await fs.rename(temp, target);
}

async function readRegularFile(file: string, maxBytes: number): Promise<string | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function writeCaseOutput(
  outputDir: string,
  index: number,
  content: string,
): Promise<StageRunRecord> {
  await replaceFile(caseOutputFile(outputDir, index), content);
  return { index, sha256: sha256(content) };
}

export async function writeStageRuns(
  outputDir: string,
  records: StageRunRecord[],
): Promise<void> {
  await replaceFile(path.join(outputDir, STAGE_RUNS_FILE), JSON.stringify(records));
}

export async function readStageRuns(outputDir: string): Promise<StageRunRecord[]> {
  const raw = await readRegularFile(path.join(outputDir, STAGE_RUNS_FILE), 1024 * 1024);
  if (raw === null) return [];
  const parsed = stageRunsSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : [];
}

export async function readCaseOutput(
  outputDir: string,
  record: StageRunRecord,
): Promise<string | null> {
  const content = await readRegularFile(
    caseOutputFile(outputDir, record.index),
    4 * MAX_EXECUTION_OUTPUT_BYTES,
  );
  return content !== null && sha256(content) === record.sha256 ? content : null;
}
