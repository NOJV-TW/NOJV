/**
 * Phase 1 security regression: a standard-mode student program must NOT be
 * able to read the expected answers from inside the sandbox.
 *
 * Before the fix, the worker shipped `testcases/{i}/expected.txt` into the
 * read-only `/submission` mount alongside `input.txt`, so a program could
 * locate its own input and echo back the sibling expected output for a
 * guaranteed AC. The fix stops shipping `expected.txt` for standard mode and
 * compares output worker-side, so the exploit reads nothing useful → WA.
 *
 * Requires a real Docker daemon and the locally-built sandbox image
 * (`pnpm sandbox:build` → `nojv-sandbox:local`). Skips cleanly otherwise.
 */
import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";

const SANDBOX_IMAGE = "nojv-sandbox:local";

function exec(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000 }, (err, stdout) => {
      resolve({ ok: !err, stdout: stdout.toString() });
    });
  });
}

async function dockerImageAvailable(): Promise<boolean> {
  if (!(await exec("docker", ["info"])).ok) return false;
  const { ok, stdout } = await exec("docker", ["images", "-q", SANDBOX_IMAGE]);
  return ok && stdout.trim().length > 0;
}

// The exploit: locate the testcase whose input matches our stdin, then print
// its sibling expected.txt. With the fix, expected.txt is absent → OSError →
// we print nothing.
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
      if (!(await dockerImageAvailable())) {
        ctx.skip();
        return;
      }

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

  // Positive control: the run/check separation must still grade a genuinely
  // correct solution as AC end-to-end (runner emits rawRuns → worker compares).
  it(
    "still grades a correct solution as AC end-to-end",
    { timeout: 120_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) {
        ctx.skip();
        return;
      }

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
        expect(tc.score).toBe(100);
      }
    },
  );
});
