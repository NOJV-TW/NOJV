import { describe, expect, it } from "vitest";

import type { SandboxRequest } from "@nojv/core";

import { DockerExecutor } from "../../../apps/worker/src/services/docker-executor.js";
import { requireSandboxImage } from "./_sandbox-image";

const SANDBOX_IMAGE = "nojv-sandbox:local";

const INTERACTOR_SCRIPT = `secret = int(judge_input.split()[0])
budget = 7
for attempt in range(budget):
    try:
        guess = int(read())
    except ValueError:
        wrong("non-integer guess")
    if guess == secret:
        write("correct")
        judge_log("STAFF_DIAG solved secret=" + str(secret))
        accept("found in " + str(attempt + 1) + " guesses")
    elif guess < secret:
        write("higher")
    else:
        write("lower")
judge_log("STAFF_DIAG budget exhausted secret=" + str(secret))
wrong("guess budget exhausted")
`;

const BINARY_SEARCH_SOLUTION = `import sys
lo, hi = 1, 100
while True:
    mid = (lo + hi) // 2
    print(mid, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
    elif resp == "higher":
        lo = mid + 1
    else:
        hi = mid - 1
`;

const STUBBORN_SOLUTION = `import sys
for _ in range(20):
    print(0, flush=True)
    sys.stdin.readline()
`;

const EXPLOIT_SOLUTION = `import sys, glob, os
secret = None
for p in glob.glob("/submission/case-*-*.txt") + glob.glob("/submission/testcase-*-*.txt"):
    try:
        secret = open(p).read().split()[0]
    except (OSError, IndexError):
        pass
if secret is None:
    secret = "-1"
for _ in range(20):
    print(secret, flush=True)
    resp = sys.stdin.readline().strip()
    if resp == "correct":
        break
`;

function makeExecutor(): DockerExecutor {
  return new DockerExecutor({
    cpuLimit: "1.0",
    image: SANDBOX_IMAGE,
    memoryMb: 256,
    pidsLimit: 64,
  });
}

function execute(request: SandboxRequest) {
  return makeExecutor().execute(request, {
    runId: request.submissionId,
    signal: new AbortController().signal,
  });
}

function interactiveRequest(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    submissionId: "interactive-iso",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    testcases: [
      { index: 0, input: "42\n", weight: 1, isSample: false },
      { index: 1, input: "73\n", weight: 1, isSample: false },
    ],
    judgeType: "interactive",
    judgeConfig: { interactorScript: INTERACTOR_SCRIPT, interactorLanguage: "python" },
    limits: { timeoutMs: 5_000, memoryMb: 256 },
    ...overrides,
  };
}

describe("interactive-mode two-container isolation (Phase 2C)", () => {
  it(
    "executes a C++ interactor in its declared language",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const result = await execute(
        interactiveRequest({
          submissionId: "interactor-cpp-language",
          sourceCode: "print(42, flush=True)",
          testcases: [{ index: 0, input: "42", weight: 1, isSample: false }],
          judgeConfig: {
            interactorLanguage: "cpp",
            interactorScript:
              "#include <fstream>\n#include <iostream>\nint main(int argc, char** argv) { std::ifstream input(argv[1]); int secret, guess; input >> secret; std::cin >> guess; return secret == guess ? 42 : 43; }",
          },
        }),
      );
      expect(result.testcaseResults).toHaveLength(1);
      expect(result.testcaseResults[0]!.verdict).toBe("AC");
    },
  );

  it(
    "grades a correct binary-search solution as AC with a partial score",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-correct",
          sourceCode: BINARY_SEARCH_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
      }
    },
  );

  it(
    "grades a solution that never finds the number as WA",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-stubborn",
          sourceCode: STUBBORN_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("WA");
      }
    },
  );

  it(
    "splits interactor messages: teammessage → student feedback, judgemessage → staffFeedback",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-channels",
          sourceCode: BINARY_SEARCH_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
        expect(tc.feedback).toMatch(/^found in \d+ guesses$/);
        expect(tc.staffFeedback).toMatch(/^STAFF_DIAG solved secret=\d+$/);
        expect(tc.feedback).not.toContain("STAFF_DIAG");
        expect(tc.feedback).not.toContain("secret=");
      }
    },
  );

  it(
    "reports an interactor crash as system error with a staff diagnostic",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-interactor-crash",
          sourceCode: "import sys\nprint(sys.stdin.readline(), flush=True)\n",
          judgeConfig: {
            interactorLanguage: "python",
            interactorScript: 'raise ValueError("invalid secret")',
          },
        }),
      );

      expect(result.compilationError).toBeUndefined();
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("SE");
        expect(tc.feedback).toBe("Interactive judge failed; this submission was not counted.");
        expect(tc.staffFeedback).toContain("ValueError: invalid secret");
      }
    },
  );

  it(
    "does not expose the secret input to the solution container",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;

      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-exploit",
          sourceCode: EXPLOIT_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});
