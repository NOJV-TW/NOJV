/**
 * Phase 2C security + correctness regression: an INTERACTIVE-mode submission
 * must run the solution and the DOMjudge interactor in two SEPARATE, isolated
 * containers wired by a worker byte proxy. The testcase secret (the hidden
 * number) is mounted ONLY into the interactor container, never the solution
 * container — so a student program cannot read it off disk and cheat.
 *
 * Correctness: a correct binary-search solution → AC (with a partial score that
 * flows from the interactor by guess count); a solution that always guesses 0 →
 * WA (guess budget exhausted).
 *
 * Security: a solution that tries to read the secret input from disk (under
 * both the /submission/cases/ and /submission/testcases/ layouts) and replays
 * it as its guess cannot reliably obtain AC — the secret is not in its
 * container.
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

// DOMjudge interactor (TA code appended after the python-interactor-domjudge
// wrapper). The secret number is the first line of judge_input. It answers each
// guess with higher/lower/correct and accepts with a guess-count-based partial
// score (fewer guesses → higher score) once the solution finds it. Range 1..100,
// so binary search needs at most 7 guesses.
const INTERACTOR_SCRIPT = `secret = int(judge_input.split()[0])
budget = 7
for attempt in range(budget):
    try:
        guess = int(read())
    except ValueError:
        wrong("non-integer guess")
    if guess == secret:
        write("correct")
        set_score(100 - attempt * 10)
        judge_log("STAFF_DIAG solved secret=" + str(secret))
        accept("found in " + str(attempt + 1) + " guesses")
    elif guess < secret:
        write("higher")
    else:
        write("lower")
judge_log("STAFF_DIAG budget exhausted secret=" + str(secret))
wrong("guess budget exhausted")
`;

// Correct solution: binary search over 1..100 reacting to higher/lower.
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

// Always guesses 0 → never matches a 1..100 secret → budget exhausted → WA.
const STUBBORN_SOLUTION = `import sys
for _ in range(20):
    print(0, flush=True)
    sys.stdin.readline()
`;

// Exploit: try to read the secret off disk under both possible layouts and
// replay it as the guess. With container isolation the files are absent → it
// falls back to a fixed wrong guess and cannot win.
const EXPLOIT_SOLUTION = `import sys, glob, os
secret = None
for d in glob.glob("/submission/cases/*") + glob.glob("/submission/testcases/*"):
    for name in ("input.txt", "answer.txt", "expected.txt"):
        try:
            secret = open(os.path.join(d, name)).read().split()[0]
        except OSError:
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

function interactiveRequest(overrides: Partial<SandboxRequest>): SandboxRequest {
  return {
    submissionId: "interactive-iso",
    sourceCode: "",
    language: "python",
    problemType: "full_source",
    // Two cases; the input's first token is the secret the interactor holds.
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
    "grades a correct binary-search solution as AC with a partial score",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
        interactiveRequest({
          submissionId: "interactive-correct",
          sourceCode: BINARY_SEARCH_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
        // Score comes from the interactor (100 - attempt*10), so AC < 100 is fine
        // but must be a positive partial score that flowed through.
        expect(tc.score).toBeGreaterThan(0);
        expect(tc.score).toBeLessThanOrEqual(100);
      }
    },
  );

  it(
    "grades a solution that never finds the number as WA",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
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
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
        interactiveRequest({
          submissionId: "interactive-channels",
          sourceCode: BINARY_SEARCH_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).toBe("AC");
        // Student-facing accept message from the interactor.
        expect(tc.feedback).toMatch(/^found in \d+ guesses$/);
        // Operator diagnostic — the secret number is in here, must NEVER appear
        // in the student channel.
        expect(tc.staffFeedback).toMatch(/^STAFF_DIAG solved secret=\d+$/);
        expect(tc.feedback).not.toContain("STAFF_DIAG");
        expect(tc.feedback).not.toContain("secret=");
      }
    },
  );

  it(
    "does not expose the secret input to the solution container",
    { timeout: 240_000 },
    async (ctx) => {
      if (!(await dockerImageAvailable())) return ctx.skip();

      const result = await makeExecutor().execute(
        interactiveRequest({
          submissionId: "interactive-exploit",
          sourceCode: EXPLOIT_SOLUTION,
        }),
      );

      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults.length).toBe(2);
      // The exploit replays a single guess; without the secret it cannot pass
      // the higher/lower protocol within the budget → not AC.
      for (const tc of result.testcaseResults) {
        expect(tc.verdict).not.toBe("AC");
      }
    },
  );
});
