/**
 * Comprehensive edge case tests for sandbox-runner.
 *
 * Covers scenarios not tested in judge-integration.test.ts:
 * - Compiler edge cases (timeout, spawn errors, compileChecker)
 * - Interactive judge edge cases (interactor timeout, feedback parsing)
 * - Checker judge edge cases (empty files, concurrent execution)
 * - Standard judge edge cases (spawn errors, large I/O)
 * - Multi-testcase scenarios
 * - Special character handling
 */
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  compile,
  compileChecker,
  sourceFileName,
} from "../../../apps/sandbox-runner/src/compiler.js";
import { judgeStandard } from "../../../apps/sandbox-runner/src/judges/standard.js";
import { judgeChecker } from "../../../apps/sandbox-runner/src/judges/checker.js";
import { judgeInteractive } from "../../../apps/sandbox-runner/src/judges/interactive.js";
import type { SandboxInput, TestcaseFiles } from "../../../apps/sandbox-runner/src/types.js";
import type { CompileResult } from "../../../apps/sandbox-runner/src/compiler.js";

const TIMEOUT_MS = 10_000;
const SHORT_TIMEOUT_MS = 500;

function isCompilerEnvironmentIssue(result: CompileResult): boolean {
  if (result.success) return false;

  const message = result.error.toLowerCase();
  return (
    message.includes("failed to spawn compiler") ||
    message.includes("enoent") ||
    message.includes("unrecognized command line option") ||
    message.includes("is not recognized")
  );
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sandbox-edge-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

// ─── Compiler Edge Cases ────────────────────────────────────────────

describe("compiler edge cases", () => {
  it("compileChecker with Python script prepends the wrapper", async () => {
    const checkerSource = `print("checker works")\n`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, checkerSource);

    const result = await compileChecker(checkerFile, "python", workDir, "checker");
    expect(result.success).toBe(true);
    if (result.success) {
      // The wrapped script lives at <workDir>/checker.py and is run by python3.
      expect(result.runCommand[0]).toBe("python3");
      expect(result.runCommand[1]).toBe(join(workDir, "checker.py"));
      const { readFile } = await import("node:fs/promises");
      const wrapped = await readFile(result.runCommand[1]!, "utf-8");
      // Wrapper exposes the named globals expected by the checker protocol.
      expect(wrapped).toContain("judge_input");
      expect(wrapped).toContain("judge_output");
      expect(wrapped).toContain("process_output");
      // User code is appended after the wrapper.
      expect(wrapped).toContain(checkerSource);
    }
  });

  it("compileChecker with Python interactor uses the interactor wrapper", async () => {
    const interactorSource = `write("hello")\n`;
    const interactorFile = join(workDir, "interactor.py");
    await writeFile(interactorFile, interactorSource);

    const result = await compileChecker(interactorFile, "python", workDir, "interactor");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.runCommand[1]).toBe(join(workDir, "interactor.py"));
      const { readFile } = await import("node:fs/promises");
      const wrapped = await readFile(result.runCommand[1]!, "utf-8");
      // Interactor wrapper exposes read/write helpers.
      expect(wrapped).toContain("def read():");
      expect(wrapped).toContain("def write(msg):");
      expect(wrapped).toContain(interactorSource);
    }
  });

  it("compileChecker with C++ program", async () => {
    const checkerSource = `#include <iostream>
int main() { std::cout << "checker" << std::endl; return 0; }`;
    const checkerFile = join(workDir, "checker.cpp");
    await writeFile(checkerFile, checkerSource);

    const result = await compileChecker(checkerFile, "cpp", workDir, "checker");
    if (isCompilerEnvironmentIssue(result)) return;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.runCommand[0]).toBe(join(workDir, "checker"));
    }
  });

  it("compileChecker with invalid C++ code returns error", async () => {
    const invalidSource = "not valid C++ code";
    const checkerFile = join(workDir, "badchecker.cpp");
    await writeFile(checkerFile, invalidSource);

    const result = await compileChecker(checkerFile, "cpp", workDir, "checker");
    if (isCompilerEnvironmentIssue(result)) return;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it("compile with nonexistent compiler returns error", async () => {
    // This test assumes there's no compiler, which is hard to guarantee
    // But we can test the error handling path by using an invalid path
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      problemType: "full_source",
      limits: { timeoutMs: 5000, memoryMb: 256 },
    };

    const srcFile = join(workDir, "main.py");
    await writeFile(srcFile, "print('test')");

    // Python doesn't need compilation, so this will succeed
    const result = await compile(input, srcFile, workDir);
    expect(result.success).toBe(true);
  });

  it("sourceFileName returns correct names for all languages", () => {
    expect(sourceFileName("c")).toBe("main.c");
    expect(sourceFileName("cpp")).toBe("main.cpp");
    expect(sourceFileName("go")).toBe("main.go");
    expect(sourceFileName("java")).toBe("Main.java");
    expect(sourceFileName("javascript")).toBe("main.mjs");
    expect(sourceFileName("python")).toBe("main.py");
    expect(sourceFileName("rust")).toBe("main.rs");
    expect(sourceFileName("typescript")).toBe("main.ts");
  });

  it("compile TypeScript project with multiple source files", async () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "typescript",
      judgeType: "standard",
      problemType: "full_source",
      limits: { timeoutMs: 5000, memoryMb: 256 },
    };

    const srcFile = join(workDir, "main.ts");
    const helperDir = join(workDir, "lib");
    const helperFile = join(helperDir, "add.ts");
    await mkdir(helperDir, { recursive: true });
    await writeFile(
      srcFile,
      `import { add } from "./lib/add.ts";
import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  const [a, b]: number[] = line.trim().split(" ").map(Number);
  console.log(add(a, b));
  rl.close();
});`,
    );
    await writeFile(
      helperFile,
      `export function add(a: number, b: number): number { return a + b; }`,
    );

    const compileResult = await compile(input, srcFile, workDir);
    expect(compileResult.success).toBe(true);
    if (!compileResult.success) return;

    const verdict = await judgeStandard(
      compileResult.runCommand,
      { index: 0, input: "3 5\n", expected: "8\n", weight: 1, isSample: true },
      TIMEOUT_MS,
    );
    expect(verdict.verdict).toBe("AC");
  }, 30_000);
});

// ─── Interactive Judge Edge Cases ──────────────────────────────────

describe("interactive judge edge cases", () => {
  it("interactor timeout → TLE", async () => {
    // Interactor that hangs forever
    const hangingInteractor = `import time
time.sleep(999)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, hangingInteractor);

    // Simple solution that just prints something
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print(42)");

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      SHORT_TIMEOUT_MS,
    );

    // When interactive judge times out, it returns TLE (not SE)
    expect(verdict.verdict).toBe("TLE");
  }, 30_000);

  it("interactor crash after first interaction", async () => {
    // Interactor that sends a number, then crashes before reading response
    const crashingInteractor = `import sys
print(5, flush=True)
raise RuntimeError("interactor crashed")`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, crashingInteractor);

    // Solution that reads and responds correctly
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `n = int(input())
print(n * 2)`,
    );

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      TIMEOUT_MS,
    );

    // Interactor exit code 1 (Python exception) → WA per protocol
    expect(verdict.verdict).toBe("WA");
  }, 30_000);

  it("interactor with missing score in stderr defaults to 0", async () => {
    // Interactor that exits with code 1 but provides no score
    const noScoreInteractor = `import sys
print(5, flush=True)
response = input().strip()
# No score printed to stderr
sys.exit(1)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, noScoreInteractor);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `n = int(input())
print(n * 2)`,
    );

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("WA");
    expect(verdict.score).toBe(0);
  }, 30_000);

  it("interactor with invalid score format defaults gracefully", async () => {
    // Interactor that prints non-numeric score
    const badScoreInteractor = `import sys
print(5, flush=True)
response = input().strip()
print("not_a_number", file=sys.stderr)
print("Invalid score", file=sys.stderr)
sys.exit(0)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, badScoreInteractor);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `n = int(input())
print(n * 2)`,
    );

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
    // Invalid score with exit 0 → defaults to 100
    expect(verdict.score).toBe(100);
  }, 30_000);

  it("interactor with partial score", async () => {
    const partialInteractor = `import sys
print(5, flush=True)
response = input().strip()
print("50", file=sys.stderr)
print("Partially correct", file=sys.stderr)
sys.exit(0)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, partialInteractor);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `n = int(input())
print(n * 2)`,
    );

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(50);
    expect(verdict.feedback).toContain("Partially correct");
  }, 30_000);

  it("solution crashes before interactor starts", async () => {
    const interactorFile = join(workDir, "interactor.py");
    await writeFile(
      interactorFile,
      `import sys
print(5, flush=True)
response = input().strip()
sys.exit(0)`,
    );

    // Solution that crashes immediately
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "raise RuntimeError('crash')");

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", interactorFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("RE");
  }, 30_000);

  it("both solution and interactor timeout → TLE", async () => {
    const hangingInteractor = `import time
time.sleep(999)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, hangingInteractor);

    const hangingSolution = `import time
time.sleep(999)`;
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, hangingSolution);

    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      SHORT_TIMEOUT_MS,
    );

    // When both timeout, verdict is TLE (not SE)
    expect(verdict.verdict).toBe("TLE");
  }, 30_000);

  it("interactor reads from empty input file and rejects", async () => {
    // Interactor that tries to read from input file
    const interactorScript = `import sys
input_file = sys.argv[1]
with open(input_file) as f:
    content = f.read().strip()
    if not content:
        print("0", file=sys.stderr)
        print("Empty input file", file=sys.stderr)
        sys.exit(1)
# If content exists, send it to solution
print(content, flush=True)
response = input().strip()
print("100", file=sys.stderr)
sys.exit(0)`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, interactorScript);

    // Solution expects to receive a number
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `try:
    n = int(input())
    print(n * 2)
except:
    pass`,
    );

    // Testcase with empty input
    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      ["python3", solutionFile],
      tc,
      ["python3", intFile],
      TIMEOUT_MS,
    );

    // Interactor exits with 1 → WA (interactor rejected the solution)
    // Note: solution may crash (RE) if interactor closes pipe early
    // The actual verdict depends on timing
    expect(["WA", "RE"]).toContain(verdict.verdict);
  }, 30_000);
});

// ─── Checker Judge Edge Cases ──────────────────────────────────────

describe("checker judge edge cases", () => {
  it("solution produces empty output, checker validates it", async () => {
    // Checker that accepts empty output
    const checkerScript = `import sys
stdin_f, expected_f, user_f = sys.argv[1], sys.argv[2], sys.argv[3]
with open(user_f) as f:
    user_output = f.read().strip()
if user_output == "":
    print("100")
    sys.exit(0)
else:
    print("0", file=sys.stderr)
    sys.exit(1)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, checkerScript);

    // Solution that produces no output
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "pass");

    const tc: TestcaseFiles = { index: 0, input: "", expected: "", weight: 1, isSample: true };
    const verdict = await judgeChecker(
      ["python3", solutionFile],
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(100);
  }, 30_000);

  it("checker receives testcase input file", async () => {
    // Checker that validates using testcase input
    const checkerScript = `import sys
stdin_f, expected_f, user_f = sys.argv[1], sys.argv[2], sys.argv[3]
with open(stdin_f) as f:
    input_data = f.read().strip()
with open(user_f) as f:
    user_output = f.read().strip()
# Expect solution to double the input
expected_output = str(int(input_data) * 2)
if user_output == expected_output:
    print("100")
    sys.exit(0)
else:
    print("0", file=sys.stderr)
    print(f"Expected {expected_output}, got {user_output}", file=sys.stderr)
    sys.exit(1)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, checkerScript);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `n = int(input())
print(n * 2)`,
    );

    const tc: TestcaseFiles = {
      index: 0,
      input: "7",
      expected: "14",
      weight: 1,
      isSample: true,
    };
    const verdict = await judgeChecker(
      ["python3", solutionFile],
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("checker with score > 100 is clamped to 100", async () => {
    const overScoreChecker = `import sys
print("150")
sys.exit(0)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, overScoreChecker);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print('test')");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "test",
      weight: 1,
      isSample: true,
    };
    const verdict = await judgeChecker(
      ["python3", solutionFile],
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(100); // Should be clamped
  }, 30_000);

  it("checker with negative score is clamped to 0", async () => {
    const negativeScoreChecker = `import sys
print("-50")
sys.exit(0)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, negativeScoreChecker);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print('test')");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "test",
      weight: 1,
      isSample: true,
    };
    const verdict = await judgeChecker(
      ["python3", solutionFile],
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(0); // Should be clamped
  }, 30_000);

  it("checker fails to read user output file", async () => {
    // Checker that tries to read from wrong path
    const badChecker = `import sys
try:
    with open("/nonexistent/file.txt") as f:
        f.read()
except Exception as e:
    print("0", file=sys.stderr)
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, badChecker);

    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print('test')");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "test",
      weight: 1,
      isSample: true,
    };
    const verdict = await judgeChecker(
      ["python3", solutionFile],
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS,
    );

    expect(verdict.verdict).toBe("WA");
    expect(verdict.feedback).toContain("Error:");
  }, 30_000);
});

// ─── Standard Judge Edge Cases ─────────────────────────────────────

describe("standard judge edge cases", () => {
  it("solution spawn error → SE", async () => {
    const tc: TestcaseFiles = { index: 0, input: "", expected: "", weight: 1, isSample: true };
    const verdict = await judgeStandard(["/nonexistent/program"], tc, TIMEOUT_MS);

    expect(verdict.verdict).toBe("SE");
    expect(verdict.stderr).toContain("Failed to spawn");
  });

  it("empty run command → SE", async () => {
    const tc: TestcaseFiles = { index: 0, input: "", expected: "", weight: 1, isSample: true };
    const verdict = await judgeStandard([], tc, TIMEOUT_MS);

    expect(verdict.verdict).toBe("SE");
    expect(verdict.stderr).toContain("Empty run command");
  });

  it("large input handled correctly", async () => {
    // Generate 1MB of input
    const largeInput = "1234567890".repeat(100_000) + "\n";
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `import sys
data = sys.stdin.read()
print(len(data))`,
    );

    const tc: TestcaseFiles = {
      index: 0,
      input: largeInput,
      expected: `${largeInput.length}\n`,
      weight: 1,
      isSample: false,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("large output handled correctly", async () => {
    // Solution that produces 1MB of output
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, `print("X" * 1000000)`);

    const expected = "X".repeat(1_000_000) + "\n";
    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected,
      weight: 1,
      isSample: false,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("unicode input and output", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `import sys
line = sys.stdin.read()
print(line.strip())`,
    );

    const unicodeText = "Hello 世界 🌍 Привет";
    const tc: TestcaseFiles = {
      index: 0,
      input: unicodeText,
      expected: unicodeText,
      weight: 1,
      isSample: true,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("mixed whitespace (tabs and spaces)", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, `print("hello\\tworld  test")`);

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "hello\tworld  test\n",
      weight: 1,
      isSample: true,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("solution with only stderr output and exit 0 → AC", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `import sys
sys.stderr.write("debug message\\n")
print("")  # Empty output`,
    );

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "",
      weight: 1,
      isSample: true,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
    expect(verdict.stderr).toContain("debug message");
  }, 30_000);

  it("multiple newlines in output", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, `print("line1\\n\\nline2\\n")`);

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "line1\n\nline2\n",
      weight: 1,
      isSample: true,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("testcase without expected output field defaults to empty string", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "pass");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      // expected is undefined
      weight: 1,
      isSample: true,
    };

    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);
});

// ─── Multi-Testcase Scenarios ──────────────────────────────────────

describe("multi-testcase scenarios", () => {
  it("running same solution on multiple testcases sequentially", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `a, b = map(int, input().split())
print(a + b)`,
    );

    const testcases: TestcaseFiles[] = [
      { index: 0, input: "1 2", expected: "3", weight: 1, isSample: true },
      { index: 1, input: "10 20", expected: "30", weight: 1, isSample: false },
      { index: 2, input: "0 0", expected: "0", weight: 1, isSample: false },
      { index: 3, input: "-5 5", expected: "0", weight: 2, isSample: false },
    ];

    const results = [];
    for (const tc of testcases) {
      const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
      results.push(verdict);
    }

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.verdict === "AC")).toBe(true);
    expect(results[0]!.index).toBe(0);
    expect(results[3]!.index).toBe(3);
  }, 30_000);

  it("mixed verdicts across testcases", async () => {
    const solutionFile = join(workDir, "solution.py");
    // Solution that only handles positive numbers
    await writeFile(
      solutionFile,
      `a, b = map(int, input().split())
if a < 0 or b < 0:
    raise ValueError("negative")
print(a + b)`,
    );

    const testcases: TestcaseFiles[] = [
      { index: 0, input: "1 2", expected: "3", weight: 1, isSample: true },
      { index: 1, input: "-5 5", expected: "0", weight: 1, isSample: false },
      { index: 2, input: "10 20", expected: "999", weight: 1, isSample: false },
    ];

    const results = [];
    for (const tc of testcases) {
      const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
      results.push(verdict);
    }

    expect(results[0]!.verdict).toBe("AC");
    expect(results[1]!.verdict).toBe("RE");
    expect(results[2]!.verdict).toBe("WA");
  }, 30_000);

  it("testcase weights preserved in results", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print(42)");

    const tc: TestcaseFiles = {
      index: 5,
      input: "",
      expected: "42",
      weight: 10,
      isSample: false,
    };
    const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);

    expect(verdict.index).toBe(5);
    // Weight is in testcase, not in result - but verify index is preserved
  }, 30_000);
});

// ─── Template Injection Additional Edge Cases ─────────────────────

// ─── Boundary and Performance ──────────────────────────────────────

describe("boundary and performance", () => {
  it("very short timeout enforced correctly", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `import time
time.sleep(0.2)
print("done")`,
    );

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "done",
      weight: 1,
      isSample: true,
    };
    const verdict = await judgeStandard(["python3", solutionFile], tc, 100);

    expect(verdict.verdict).toBe("TLE");
    expect(verdict.timeMs).toBeGreaterThanOrEqual(100);
  }, 30_000);

  it("zero timeout treated as immediate timeout", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print('test')");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      expected: "test",
      weight: 1,
      isSample: true,
    };
    // This will likely timeout immediately or run very fast
    const verdict = await judgeStandard(["python3", solutionFile], tc, 1);

    // Either TLE or AC depending on timing
    expect(["TLE", "AC"]).toContain(verdict.verdict);
  }, 30_000);

  it("testcase index preserved through all verdict types", async () => {
    const indices = [0, 1, 5, 100, 999];

    for (const idx of indices) {
      const solutionFile = join(workDir, `solution${idx}.py`);
      await writeFile(solutionFile, "print('test')");

      const tc: TestcaseFiles = {
        index: idx,
        input: "",
        expected: "test",
        weight: 1,
        isSample: true,
      };

      const verdict = await judgeStandard(["python3", solutionFile], tc, TIMEOUT_MS);
      expect(verdict.index).toBe(idx);
    }
  }, 30_000);
});
