import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { parseInteractiveRunReports, type SandboxRequest } from "@nojv/core";
import { buildSandboxDockerArgs } from "../../../apps/worker/src/sandbox/docker/args";
import { writeSolutionFiles } from "../../../apps/worker/src/sandbox/docker/interactive-executor";

import { DockerExecutor } from "../../../apps/worker/src/sandbox/docker/executor.js";
import { requireSandboxImage } from "./_sandbox-image";

const SANDBOX_IMAGE = process.env.NOJV_TEST_SANDBOX_IMAGE ?? "nojv-sandbox:local";

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

function makeExecutor(image = SANDBOX_IMAGE): DockerExecutor {
  return new DockerExecutor({
    cpuLimit: "1.0",
    image,
    memoryMb: 256,
    pidsLimit: 64,
  });
}

function execute(request: SandboxRequest, image = SANDBOX_IMAGE) {
  return makeExecutor(image).execute(request, {
    runId: request.submissionId,
    signal: new AbortController().signal,
  });
}

async function withDelayedCompiler(
  compiler: "gcc" | "g++",
  delaySeconds: number,
  run: (image: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "nojv-interactive-compiler-delay-"));
  const image = `nojv-interactive-delay:${randomUUID()}`;
  let built = false;
  try {
    await writeFile(
      join(directory, "delayed-compiler"),
      `#!/bin/sh\nsleep ${String(delaySeconds)}\nexec /usr/bin/${compiler} "$@"\n`,
    );
    await writeFile(
      join(directory, "Dockerfile"),
      [
        "ARG SANDBOX_IMAGE",
        "FROM ${SANDBOX_IMAGE}",
        "USER root",
        `COPY delayed-compiler /test-bin/${compiler}`,
        `RUN test -x /usr/bin/${compiler} && chmod 755 /test-bin/${compiler}`,
        "ENV PATH=/test-bin:$PATH",
        "USER sandbox",
        "",
      ].join("\n"),
    );
    await promisify(execFile)(
      "docker",
      [
        "build",
        "--network=none",
        "--pull=false",
        "--build-arg",
        `SANDBOX_IMAGE=${SANDBOX_IMAGE}`,
        "--tag",
        image,
        directory,
      ],
      { timeout: 90_000 },
    );
    built = true;
    await run(image);
  } finally {
    try {
      if (built)
        await promisify(execFile)("docker", ["image", "rm", image], { timeout: 30_000 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

const C_CHALLENGE_SOLUTION = `#include <stdio.h>
int main(void) {
  long long input;
  if (scanf("%lld", &input) != 1) return 1;
  printf("%lld\\n", input * 2);
  fflush(stdout);
  return 0;
}
`;

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
    "excludes delayed C++ interactor compilation from the one-second student limit",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      await withDelayedCompiler("g++", 3, async (image) => {
        const started = performance.now();
        const result = await execute(
          interactiveRequest({
            submissionId: "interactive-delayed-interactor-compile",
            language: "c",
            sourceCode: C_CHALLENGE_SOLUTION,
            testcases: [{ index: 0, input: "7\n", output: "14\n", weight: 1, isSample: false }],
            limits: { timeoutMs: 1_000, memoryMb: 256 },
            judgeConfig: {
              interactorLanguage: "cpp",
              interactorScript: `#include <fstream>
#include <iostream>
int main(int argc, char** argv) {
  if (argc != 4) return 1;
  std::ifstream input(argv[1]), answer(argv[2]);
  long long challenge, expected, response;
  if (!(input >> challenge) || !(answer >> expected)) return 1;
  std::cout << challenge << std::endl;
  if (!(std::cin >> response)) return 43;
  return response == expected ? 42 : 43;
}
`,
            },
          }),
          image,
        );
        expect(performance.now() - started).toBeGreaterThanOrEqual(3_000);
        expect(result.compilationError).toBeUndefined();
        expect(result.testcaseResults).toHaveLength(1);
        expect(result.testcaseResults[0]).toMatchObject({
          index: 0,
          verdict: "AC",
          exitCode: 0,
        });
        expect(result.testcaseResults[0]!.timeMs).toBeLessThan(1_000);
      });
    },
  );

  it(
    "excludes student compilation beyond the interactor budget from judge execution time",
    { timeout: 180_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      await withDelayedCompiler("gcc", 32, async (image) => {
        const started = performance.now();
        const result = await execute(
          interactiveRequest({
            submissionId: "interactive-delayed-student-compile",
            language: "c",
            sourceCode: C_CHALLENGE_SOLUTION,
            testcases: [{ index: 0, input: "7\n", output: "14\n", weight: 1, isSample: false }],
            limits: { timeoutMs: 5_000, memoryMb: 256 },
            judgeConfig: {
              interactorLanguage: "python",
              interactorScript: `write(judge_input.strip())
if read().strip() == str(int(judge_input.strip()) * 2):
    accept("Accepted.")
else:
    wrong("Wrong response.")
`,
            },
          }),
          image,
        );
        expect(performance.now() - started).toBeGreaterThanOrEqual(32_000);
        expect(result.compilationError).toBeUndefined();
        expect(result.testcaseResults).toHaveLength(1);
        expect(result.testcaseResults[0]).toMatchObject({
          index: 0,
          verdict: "AC",
          exitCode: 0,
        });
        expect(result.testcaseResults[0]!.timeMs).toBeLessThan(5_000);
      });
    },
  );

  it(
    "keeps a student compiler diagnostic off the interactive stdout channel",
    { timeout: 60_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const request = interactiveRequest({ language: "c", sourceCode: "int main( {\n" });
      const directory = await mkdtemp(join(tmpdir(), "nojv-interactive-ce-"));
      try {
        await writeSolutionFiles(directory, request);
        const { stdout, stderr } = await promisify(execFile)(
          "docker",
          buildSandboxDockerArgs({
            containerName: "nojv-interactive-ce-channel",
            networkArgs: ["--network", "none"],
            tempDir: directory,
            cpuLimit: "1",
            memoryMb: 256,
            pidsLimit: 64,
            image: SANDBOX_IMAGE,
          }),
          { timeout: 50_000 },
        );
        expect(stdout).toBe("");
        expect(parseInteractiveRunReports(stderr).at(-1)?.compilationError).toContain("error:");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it(
    "returns student compilation failure as top-level CE, not platform failure",
    { timeout: 120_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-student-ce",
          language: "c",
          sourceCode: "int main( {\n",
        }),
      );
      expect(result.compilationError).toContain("error:");
      expect(result.testcaseResults).toEqual([]);
    },
  );

  it(
    "keeps interactor compilation failure as SE with a staff diagnostic",
    { timeout: 120_000 },
    async (ctx) => {
      if (!(await requireSandboxImage(ctx))) return;
      const result = await execute(
        interactiveRequest({
          submissionId: "interactive-interactor-ce",
          sourceCode: "print(42, flush=True)",
          testcases: [{ index: 0, input: "42", weight: 1, isSample: false }],
          judgeConfig: { interactorLanguage: "cpp", interactorScript: "int main( {\n" },
        }),
      );
      expect(result.compilationError).toBeUndefined();
      expect(result.testcaseResults[0]?.verdict).toBe("SE");
      expect(result.testcaseResults[0]?.staffFeedback).toContain(
        "Interactor compilation failed:",
      );
      expect(result.testcaseResults[0]?.staffFeedback).toContain("error:");
      expect(result.testcaseResults[0]?.feedback).not.toContain("error:");
    },
  );

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
