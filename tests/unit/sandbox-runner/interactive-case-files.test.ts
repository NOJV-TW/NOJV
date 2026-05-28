import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveInteractiveCaseFiles } from "../../../apps/sandbox-runner/src/judges/interactive-isolated.js";

let submissionDir: string;

beforeEach(async () => {
  submissionDir = await mkdtemp(join(tmpdir(), "interactive-case-files-"));
});

afterEach(async () => {
  await rm(submissionDir, { recursive: true, force: true }).catch(() => {});
});

describe("resolveInteractiveCaseFiles", () => {
  it("reads directory layout (Docker): /submission/cases/{index}/{input,answer}.txt", async () => {
    const caseDir = join(submissionDir, "cases", "3");
    await mkdir(caseDir, { recursive: true });
    await writeFile(join(caseDir, "input.txt"), "in\n");
    await writeFile(join(caseDir, "answer.txt"), "ans\n");

    const files = await resolveInteractiveCaseFiles(submissionDir, 3);

    expect(files.inputFile).toBe(join(caseDir, "input.txt"));
    expect(files.answerFile).toBe(join(caseDir, "answer.txt"));
  });

  it("falls back to flat-key layout (K8s): /submission/case-{i}-{input,answer}.txt", async () => {
    await writeFile(join(submissionDir, "case-7-input.txt"), "in7\n");
    await writeFile(join(submissionDir, "case-7-answer.txt"), "ans7\n");

    const files = await resolveInteractiveCaseFiles(submissionDir, 7);

    expect(files.inputFile).toBe(join(submissionDir, "case-7-input.txt"));
    expect(files.answerFile).toBe(join(submissionDir, "case-7-answer.txt"));
  });

  it("prefers directory layout when both are present", async () => {
    const caseDir = join(submissionDir, "cases", "0");
    await mkdir(caseDir, { recursive: true });
    await writeFile(join(caseDir, "input.txt"), "dir-in\n");
    await writeFile(join(caseDir, "answer.txt"), "dir-ans\n");

    await writeFile(join(submissionDir, "case-0-input.txt"), "flat-in\n");
    await writeFile(join(submissionDir, "case-0-answer.txt"), "flat-ans\n");

    const files = await resolveInteractiveCaseFiles(submissionDir, 0);

    expect(files.inputFile).toBe(join(caseDir, "input.txt"));
    expect(files.answerFile).toBe(join(caseDir, "answer.txt"));
  });
});
