/**
 * Phase 2B security + correctness regression: a CHECKER-mode submission must be
 * graded by a DOMjudge output validator running in a SEPARATE, isolated
 * container. The student's run container must NOT contain the validator source
 * or the expected answer — only the student source + testcase inputs.
 *
 * Correctness: a correct solution → AC, a wrong one → WA, and a validator that
 * sets a partial score has that score flow through.
 *
 * Security: a solution that tries to read the validator script and the answer
 * files (under both the new /submission/cases/ layout and the old
 * /submission/testcases/expected.txt layout) cannot obtain them, so the
 * echo-the-answer exploit gets WA, not AC.
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

// DOMjudge validator (TA code appended after the python-validator wrapper).
// Whitespace-insensitive equality; awards a partial 50 when the team output is
// a non-empty prefix of the answer.
const VALIDATOR_SCRIPT = `team = team_output.split()
ans = judge_answer.split()
if team == ans:
    accept("exact match")
elif team and team == ans[:len(team)]:
    set_score(50)
    wrong("partial prefix")
else:
    judge_log("expected " + judge_answer)
    wrong("wrong answer")
`;

function makeExecutor(): DockerExecutor {
  return new DockerExecutor({
    cpuLimit: "1.0",
    image: SANDBOX_IMAGE,
    memoryMb: 256,
    pidsLimit: 64,
  });
}

function checkerRequest(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    submissionId: "checker-iso",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    testcases: [
      { index: 0, input: "1 2\n", output: "1 2 3\n", weight: 1, isSample: false },
      { index: 1, input: "10 20\n", output: "10 20 30\n", weight: 1, isSample: false },
    ],
    judgeType: "checker",
    judgeConfig: { checkerScript: VALIDATOR_SCRIPT, checkerLanguage: "python" },
    limits: { timeoutMs: 5_000, memoryMb: 256 },
    ...overrides,
  };
}

describe("checker-mode isolated validation (Phase 2B)", () => {
  it(
    "grades a correct solution as AC via the isolated validator",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId: "checker-correct",
          // echoes the two numbers and their sum, in any spacing the validator tolerates
          sourceCode: "a, b = map(int, input().split())\nprint(a, b, a + b)\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
        expect(tc.score).toBe(100);
      }
    },
  );

  it(
    "grades a wrong solution as WA via the isolated validator",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId: "checker-wrong",
          sourceCode: "print('totally wrong')\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
    },
  );

  it("flows a partial score set by the validator", { timeout: 180_000 }, async (ctx) => {
    if (!(await dockerImageAvailable())) return ctx.skip();

    const result = await makeExecutor().execute(
      checkerRequest({
        submissionId: "checker-partial",
        // prints only the two numbers (a non-empty prefix of the answer) → partial 50
        sourceCode: "a, b = map(int, input().split())\nprint(a, b)\n",
      }),
    );

    expect(result.compilationError).toBeUndefined();
    for (const tc of result.testcaseResults) {
      expect(tc.verdict).toBe("WA");
      expect(tc.score).toBe(50);
    }
  });

  it(
    "does not expose the validator script or the answer to the run container",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      // The exploit: try to echo the validator source AND any answer file it can
      // find (new cases/ layout + old testcases/expected.txt layout). If any of
      // those were present in the run container, the validator would see the
      // answer echoed back and award AC. With isolation, nothing is readable →
      // the output never matches → WA.
      const exploit = `import glob, os
chunks = []
for p in ["/submission/validator.py", "/submission/validator.cpp"]:
    try: chunks.append(open(p).read())
    except OSError: pass
for d in glob.glob("/submission/cases/*") + glob.glob("/submission/testcases/*"):
    for name in ("answer.txt", "expected.txt"):
        try: chunks.append(open(os.path.join(d, name)).read())
        except OSError: pass
print("".join(chunks))
`;

      const result = await makeExecutor().execute(
        checkerRequest({ submissionId: "checker-exploit", sourceCode: exploit }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});
