import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestcaseFiles } from "./types.js";

export async function readTestcase(
  submissionDir: string,
  index: number,
): Promise<TestcaseFiles> {
  const inputPath = join(submissionDir, `testcase-${String(index)}-input.txt`);
  return { index, input: await readFile(inputPath, "utf8") };
}
