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
  await rm(submissionDir, { recursive: true, force: true }).catch(() => {});
});

describe("resolveValidateCaseFiles", () => {
  it("reads directory layout (Docker): /submission/cases/{index}/{input,answer,team}.txt", async () => {
    const caseDir = join(submissionDir, "cases", "3");
    await mkdir(caseDir, { recursive: true });
    await writeFile(join(caseDir, "input.txt"), "in\n");
    await writeFile(join(caseDir, "answer.txt"), "ans\n");
    await writeFile(join(caseDir, "team.txt"), "out\n");

    const files = await resolveValidateCaseFiles(submissionDir, 3);

    expect(files.inputFile).toBe(join(caseDir, "input.txt"));
    expect(files.answerFile).toBe(join(caseDir, "answer.txt"));
    expect(files.teamOutput).toBe("out\n");
  });

  it("falls back to flat-key layout (K8s): /submission/case-{i}-{input,answer,team}.txt", async () => {
    await writeFile(join(submissionDir, "case-7-input.txt"), "in7\n");
    await writeFile(join(submissionDir, "case-7-answer.txt"), "ans7\n");
    await writeFile(join(submissionDir, "case-7-team.txt"), "out7\n");

    const files = await resolveValidateCaseFiles(submissionDir, 7);

    expect(files.inputFile).toBe(join(submissionDir, "case-7-input.txt"));
    expect(files.answerFile).toBe(join(submissionDir, "case-7-answer.txt"));
    expect(files.teamOutput).toBe("out7\n");
  });

  it("prefers directory layout when both are present", async () => {
    const caseDir = join(submissionDir, "cases", "0");
    await mkdir(caseDir, { recursive: true });
    await writeFile(join(caseDir, "input.txt"), "dir-in\n");
    await writeFile(join(caseDir, "answer.txt"), "dir-ans\n");
    await writeFile(join(caseDir, "team.txt"), "dir-out\n");

    await writeFile(join(submissionDir, "case-0-input.txt"), "flat-in\n");
    await writeFile(join(submissionDir, "case-0-answer.txt"), "flat-ans\n");
    await writeFile(join(submissionDir, "case-0-team.txt"), "flat-out\n");

    const files = await resolveValidateCaseFiles(submissionDir, 0);

    expect(files.inputFile).toBe(join(caseDir, "input.txt"));
    expect(files.teamOutput).toBe("dir-out\n");
  });

  it("returns empty teamOutput when the team file is missing", async () => {
    const caseDir = join(submissionDir, "cases", "0");
    await mkdir(caseDir, { recursive: true });
    await writeFile(join(caseDir, "input.txt"), "in\n");
    await writeFile(join(caseDir, "answer.txt"), "ans\n");

    const files = await resolveValidateCaseFiles(submissionDir, 0);

    expect(files.teamOutput).toBe("");
  });
});
