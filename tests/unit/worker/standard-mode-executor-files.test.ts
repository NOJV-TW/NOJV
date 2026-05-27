import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeSubmissionFiles } from "../../../apps/worker/src/services/standard-mode-executor";

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function makeRequest(judgeType: SandboxRequest["judgeType"]): SandboxRequest {
  return {
    submissionId: "sub-1",
    sourceCode: "print(1)",
    language: "python",
    problemType: "full_source",
    testcases: [
      { index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false },
      { index: 1, input: "4 5\n", output: "9\n", weight: 1, isSample: false },
    ],
    judgeType,
    judgeConfig: {},
    limits: { timeoutMs: 1_000, memoryMb: 256 },
  };
}

describe("writeSubmissionFiles expected-output gating", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "nojv-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("never writes expected.txt for standard mode but always writes input.txt", async () => {
    await writeSubmissionFiles(tempDir, makeRequest("standard"));

    expect(await exists(join(tempDir, "testcases", "0", "input.txt"))).toBe(true);
    expect(await exists(join(tempDir, "testcases", "1", "input.txt"))).toBe(true);
    expect(await exists(join(tempDir, "testcases", "0", "expected.txt"))).toBe(false);
    expect(await exists(join(tempDir, "testcases", "1", "expected.txt"))).toBe(false);
  });

  it("still writes expected.txt for checker mode", async () => {
    await writeSubmissionFiles(tempDir, makeRequest("checker"));

    expect(await exists(join(tempDir, "testcases", "0", "expected.txt"))).toBe(true);
    expect(await readFile(join(tempDir, "testcases", "0", "expected.txt"), "utf8")).toBe("3\n");
  });
});
