import { mkdtemp, rm, access, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTestcase } from "../../../apps/sandbox-runner/src/testcase-files";
import { buildTestcaseConfigMapData } from "../../../apps/worker/src/services/k8s-configmaps";
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
    judgeConfig:
      judgeType === "checker" ? { checkerScript: "accept()\n", checkerLanguage: "python" } : {},
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

  it.each(["docker", "kubernetes"])(
    "%s payload is read one testcase at a time",
    async (backend) => {
      const request = makeRequest("standard");
      const flatData = buildTestcaseConfigMapData(request);
      if (backend === "docker") await writeSubmissionFiles(tempDir, request);
      else
        await Promise.all(
          Object.entries(flatData).map(([key, value]) => writeFile(join(tempDir, key), value)),
        );
      for (const [key, value] of Object.entries(flatData)) {
        expect(await readFile(join(tempDir, key), "utf8")).toBe(value);
      }
      await rm(join(tempDir, "testcase-1-input.txt"));
      await mkdir(join(tempDir, "testcase-1-input.txt"));
      expect(await readTestcase(tempDir, 0)).toEqual({ index: 0, input: "1 2\n" });
      await expect(readTestcase(tempDir, 1)).rejects.toMatchObject({ code: "EISDIR" });
      await expect(readTestcase(tempDir, 2)).rejects.toThrow("testcase-2-input.txt");
    },
  );

  it("never writes expected.txt for standard mode but always writes input.txt", async () => {
    await writeSubmissionFiles(tempDir, makeRequest("standard"));

    expect(await exists(join(tempDir, "testcase-0-input.txt"))).toBe(true);
    expect(await exists(join(tempDir, "testcase-1-input.txt"))).toBe(true);
    expect(await exists(join(tempDir, "testcase-0-expected.txt"))).toBe(false);
    expect(await exists(join(tempDir, "testcase-1-expected.txt"))).toBe(false);
  });

  it("ships neither expected.txt nor the checker script into the run container (checker mode)", async () => {
    await writeSubmissionFiles(tempDir, makeRequest("checker"));

    expect(await exists(join(tempDir, "testcase-0-input.txt"))).toBe(true);
    expect(await exists(join(tempDir, "testcase-0-expected.txt"))).toBe(false);
    expect(await exists(join(tempDir, "checker.py"))).toBe(false);
  });
});
