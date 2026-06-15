import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";
import { requireSandboxImage } from "./_sandbox-image";

const SANDBOX_IMAGE = "nojv-sandbox:local";

const EXPLOIT_SOURCE = `import sys, glob, os
mine = sys.stdin.read()
for d in glob.glob("/submission/testcases/*"):
    try:
        if open(os.path.join(d, "input.txt")).read() == mine:
            sys.stdout.write(open(os.path.join(d, "expected.txt")).read()); break
    except OSError:
        pass
`;

describe("standard-mode testcase exposure (isolation)", () => {
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

      const result = await executor.execute(request);

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

    const result = await executor.execute(request);

    expect(result.compilationError).toBeUndefined();
    expect(result.testcaseResults.length).toBe(2);
    for (const tc of result.testcaseResults) {
      expect(tc.verdict).toBe("AC");
    }
  });
});
