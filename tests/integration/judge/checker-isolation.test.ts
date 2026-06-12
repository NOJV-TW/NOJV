import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";
import { requireSandboxImage } from "./_sandbox-image";

const SANDBOX_IMAGE = "nojv-sandbox:local";

const VALIDATOR_SCRIPT = `team = team_output.split()
ans = judge_answer.split()
if team == ans:
    accept("exact match")
elif team and team == ans[:len(team)]:
    set_score(50)
    judge_log("STAFF_DIAG partial prefix len=" + str(len(team)))
    wrong("partial prefix")
else:
    judge_log("STAFF_DIAG expected " + judge_answer)
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
      if (!(await requireSandboxImage(ctx))) return;

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId: "checker-correct",
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
      if (!(await requireSandboxImage(ctx))) return;

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
    if (!(await requireSandboxImage(ctx))) return;

    const result = await makeExecutor().execute(
      checkerRequest({
        submissionId: "checker-partial",
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
    "splits validator messages: teammessage → student feedback, judgemessage → staffFeedback",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await makeExecutor().execute(
        checkerRequest({
          submissionId: "checker-channels",
          sourceCode: "print('totally wrong')\n",
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
        expect(tc.feedback).toBe("wrong answer");
        expect(tc.staffFeedback).toMatch(/^STAFF_DIAG expected /);
        expect(tc.feedback).not.toContain("STAFF_DIAG");
      }
    },
  );

  it(
    "does not expose the validator script or the answer to the run container",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

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
