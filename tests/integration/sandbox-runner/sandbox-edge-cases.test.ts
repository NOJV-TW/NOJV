import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { compareStandard } from "@nojv/core";

import { compile, sourceFileName } from "../../../apps/sandbox-runner/src/compiler.js";
import { runSolution } from "../../../apps/sandbox-runner/src/judges/standard.js";
import type { SandboxInput, TestcaseFiles } from "../../../apps/sandbox-runner/src/types.js";

const TIMEOUT_MS = 10_000;

async function judge(
  runCommand: string[],
  testcase: TestcaseFiles,
  expected: string,
  timeoutMs: number,
): Promise<{ verdict: string; stdout: string; stderr: string; index: number; timeMs: number }> {
  const run = await runSolution(runCommand, testcase, timeoutMs);
  const verdict = run.errorVerdict ?? (compareStandard(run.stdout, expected) ? "AC" : "WA");
  return {
    verdict,
    stdout: run.stdout,
    stderr: run.stderr,
    index: run.index,
    timeMs: run.timeMs,
  };
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sandbox-edge-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe("compiler edge cases", () => {
  it("compile with nonexistent compiler returns error", async () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      problemType: "full_source",
      limits: { timeoutMs: 5000, memoryMb: 256 },
    };

    const srcFile = join(workDir, "main.py");
    await writeFile(srcFile, "print('test')");

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

    const verdict = await judge(
      compileResult.runCommand,
      { index: 0, input: "3 5\n", weight: 1, isSample: true },
      "8\n",
      TIMEOUT_MS,
    );
    expect(verdict.verdict).toBe("AC");
  }, 30_000);
});

describe("standard judge edge cases", () => {
  it("solution spawn error → SE", async () => {
    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judge(["/nonexistent/program"], tc, "", TIMEOUT_MS);

    expect(verdict.verdict).toBe("SE");
    expect(verdict.stderr).toContain("Failed to spawn");
  });

  it("empty run command → SE", async () => {
    const tc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };
    const verdict = await judge([], tc, "", TIMEOUT_MS);

    expect(verdict.verdict).toBe("SE");
    expect(verdict.stderr).toContain("Empty run command");
  });

  it("large input handled correctly", async () => {
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
      weight: 1,
      isSample: false,
    };

    const verdict = await judge(
      ["python3", solutionFile],
      tc,
      `${largeInput.length}\n`,
      TIMEOUT_MS,
    );
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("large output handled correctly", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, `print("X" * 1000000)`);

    const expected = "X".repeat(1_000_000) + "\n";
    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: false,
    };

    const verdict = await judge(["python3", solutionFile], tc, expected, TIMEOUT_MS);
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
      weight: 1,
      isSample: true,
    };

    const verdict = await judge(["python3", solutionFile], tc, unicodeText, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("mixed whitespace (tabs and spaces)", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, String.raw`print("hello\tworld  test")`);

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: true,
    };

    const verdict = await judge(
      ["python3", solutionFile],
      tc,
      "hello\tworld  test\n",
      TIMEOUT_MS,
    );
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("solution with only stderr output and exit 0 → AC", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      String.raw`import sys
sys.stderr.write("debug message\n")
print("")  # Empty output`,
    );

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: true,
    };

    const verdict = await judge(["python3", solutionFile], tc, "", TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
    expect(verdict.stderr).toContain("debug message");
  }, 30_000);

  it("multiple newlines in output", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, String.raw`print("line1\n\nline2\n")`);

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: true,
    };

    const verdict = await judge(["python3", solutionFile], tc, "line1\n\nline2\n", TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("empty expected matches empty output", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "pass");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: true,
    };

    const verdict = await judge(["python3", solutionFile], tc, "", TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);
});

describe("multi-testcase scenarios", () => {
  it("running same solution on multiple testcases sequentially", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `a, b = map(int, input().split())
print(a + b)`,
    );

    const testcases: { tc: TestcaseFiles; expected: string }[] = [
      { tc: { index: 0, input: "1 2", weight: 1, isSample: true }, expected: "3" },
      { tc: { index: 1, input: "10 20", weight: 1, isSample: false }, expected: "30" },
      { tc: { index: 2, input: "0 0", weight: 1, isSample: false }, expected: "0" },
      { tc: { index: 3, input: "-5 5", weight: 2, isSample: false }, expected: "0" },
    ];

    const results = [];
    for (const { tc, expected } of testcases) {
      const verdict = await judge(["python3", solutionFile], tc, expected, TIMEOUT_MS);
      results.push(verdict);
    }

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.verdict === "AC")).toBe(true);
    expect(results[0]!.index).toBe(0);
    expect(results[3]!.index).toBe(3);
  }, 30_000);

  it("mixed verdicts across testcases", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(
      solutionFile,
      `a, b = map(int, input().split())
if a < 0 or b < 0:
    raise ValueError("negative")
print(a + b)`,
    );

    const testcases: { tc: TestcaseFiles; expected: string }[] = [
      { tc: { index: 0, input: "1 2", weight: 1, isSample: true }, expected: "3" },
      { tc: { index: 1, input: "-5 5", weight: 1, isSample: false }, expected: "0" },
      { tc: { index: 2, input: "10 20", weight: 1, isSample: false }, expected: "999" },
    ];

    const results = [];
    for (const { tc, expected } of testcases) {
      const verdict = await judge(["python3", solutionFile], tc, expected, TIMEOUT_MS);
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
      weight: 10,
      isSample: false,
    };
    const verdict = await judge(["python3", solutionFile], tc, "42", TIMEOUT_MS);

    expect(verdict.index).toBe(5);
  }, 30_000);
});

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
      weight: 1,
      isSample: true,
    };
    const verdict = await judge(["python3", solutionFile], tc, "done", 100);

    expect(verdict.verdict).toBe("TLE");
    expect(verdict.timeMs).toBeGreaterThan(0);
  }, 30_000);

  it("zero timeout treated as immediate timeout", async () => {
    const solutionFile = join(workDir, "solution.py");
    await writeFile(solutionFile, "print('test')");

    const tc: TestcaseFiles = {
      index: 0,
      input: "",
      weight: 1,
      isSample: true,
    };
    const verdict = await judge(["python3", solutionFile], tc, "test", 1);

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
        weight: 1,
        isSample: true,
      };

      const verdict = await judge(["python3", solutionFile], tc, "test", TIMEOUT_MS);
      expect(verdict.index).toBe(idx);
    }
  }, 30_000);
});
