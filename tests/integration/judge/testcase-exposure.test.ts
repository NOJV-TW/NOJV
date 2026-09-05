import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";
import { requireSandboxImage } from "./_sandbox-image";

const SANDBOX_IMAGE = "nojv-sandbox:local";

const EXPLOIT_SOURCE = `import sys, glob
mine = sys.stdin.read()
inputs = glob.glob("/submission/testcase-*-input.txt")
assert inputs, "exploit did not inspect the current payload layout"
for input_path in inputs:
    if open(input_path).read() == mine:
        for suffix in ("expected.txt", "answer.txt"):
            try:
                sys.stdout.write(open(input_path.replace("input.txt", suffix)).read())
            except FileNotFoundError:
                pass
`;

function execute(executor: DockerExecutor, request: SandboxRequest) {
  return executor.execute(request, {
    runId: request.submissionId,
    signal: new AbortController().signal,
  });
}

describe("standard-mode testcase exposure (isolation)", () => {
  it(
    "rejects a missing explicit entry file even when the default exists",
    { timeout: 120_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const executor = new DockerExecutor({
        cpuLimit: "1.0",
        image: SANDBOX_IMAGE,
        memoryMb: 256,
        pidsLimit: 64,
      });
      const result = await execute(executor, {
        submissionId: "missing-entry-test",
        sourceCode: "print(3)\n",
        language: "python",
        entryFile: "missing.py",
        problemType: "full_source",
        testcases: [{ index: 0, input: "", output: "3\n", weight: 1, isSample: false }],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 5000, memoryMb: 256 },
      });

      expect(result.testcaseResults).toHaveLength(1);
      expect(result.testcaseResults[0]).toMatchObject({
        verdict: "SE",
        stderr: expect.stringContaining("ENOENT"),
      });
      expect(result.testcaseResults[0]?.stderr).toContain("/submission/missing.py");
    },
  );

  it(
    "cannot read expected output from inside the sandbox (verdict WA)",
    { timeout: 120_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const executor = new DockerExecutor({
        cpuLimit: "1.0",
        image: SANDBOX_IMAGE,
        memoryMb: 256,
        pidsLimit: 64,
      });

      const request: SandboxRequest = {
        submissionId: "exploit-test",
        sourceCode: EXPLOIT_SOURCE,
        language: "python",
        problemType: "full_source",
        testcases: [
          { index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false },
          { index: 1, input: "10 20\n", output: "30\n", weight: 1, isSample: false },
        ],
        judgeType: "standard",
        judgeConfig: {},
        limits: { timeoutMs: 5_000, memoryMb: 256 },
      };

      const result = await execute(executor, request);

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
    },
  );

  it("still grades a correct solution as AC end-to-end", { timeout: 120_000 }, async (ctx) => {
    if (!(await requireSandboxImage(ctx))) return;

    const executor = new DockerExecutor({
      cpuLimit: "1.0",
      image: SANDBOX_IMAGE,
      memoryMb: 256,
      pidsLimit: 64,
    });

    const request: SandboxRequest = {
      submissionId: "correct-test",
      sourceCode: "a, b = map(int, input().split())\nprint(a + b)\n",
      language: "python",
      problemType: "full_source",
      testcases: [
        { index: 0, input: "1 2\n", output: "3\n", weight: 1, isSample: false },
        { index: 1, input: "10 20\n", output: "30\n", weight: 1, isSample: false },
      ],
      judgeType: "standard",
      judgeConfig: {},
      limits: { timeoutMs: 5_000, memoryMb: 256 },
    };

    const result = await execute(executor, request);

    expect(result.compilationError).toBeUndefined();
    expect(result.testcaseResults.length).toBe(2);
    for (const tc of result.testcaseResults) {
      expect(tc.verdict).toBe("AC");
    }
  });
});
