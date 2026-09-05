import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveValidateCaseFiles } from "../../../apps/sandbox-runner/src/judges/validate.js";

let submissionDir: string;

beforeEach(async () => {
  submissionDir = await mkdtemp(join(tmpdir(), "validate-case-files-"));
});

afterEach(async () => {
  await rm(submissionDir, { recursive: true, force: true });
});

describe("resolveValidateCaseFiles", () => {
  it("reads the shared flat payload", async () => {
    await writeFile(join(submissionDir, "case-7-input.txt"), "in7\n");
    await writeFile(join(submissionDir, "case-7-answer.txt"), "ans7\n");
    await writeFile(join(submissionDir, "case-7-team.txt"), "out7\n");
    const files = await resolveValidateCaseFiles(submissionDir, 7);
    expect(files).toEqual({
      inputFile: join(submissionDir, "case-7-input.txt"),
      answerFile: join(submissionDir, "case-7-answer.txt"),
      teamOutput: "out7\n",
    });
  });

  it("preserves a legitimate empty output file", async () => {
    await writeFile(join(submissionDir, "case-0-team.txt"), "");
    expect((await resolveValidateCaseFiles(submissionDir, 0)).teamOutput).toBe("");
  });

  it("reports the path of a missing required team output", async () => {
    await expect(resolveValidateCaseFiles(submissionDir, 0)).rejects.toThrow("case-0-team.txt");
  });

  it("preserves a non-ENOENT read error instead of substituting empty output", async () => {
    await mkdir(join(submissionDir, "case-0-team.txt"));
    await expect(resolveValidateCaseFiles(submissionDir, 0)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });
});
