/**
 * Comprehensive integration tests: 8 languages × standard judge × all verdicts.
 *
 * Verdicts: AC, WA, RE, TLE, CE, MLE, SE
 * Languages: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
 *
 * Checker and interactive judging are run/check-separated across isolated
 * containers — their integration coverage lives in tests/integration/judge/.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { compile, sourceFileName } from "../../../apps/sandbox-runner/src/compiler.js";
import { judgeStandard } from "../../../apps/sandbox-runner/src/judges/standard.js";
import type { SandboxInput, TestcaseFiles } from "../../../apps/sandbox-runner/src/types.js";

const TIMEOUT_MS = 10_000;
const SHORT_TIMEOUT_MS = 500;

// ─── Utilities ──────────────────────────────────────────────────────

const commandVersionFlags: Record<string, string> = {
  gcc: "--version",
  "g++": "--version",
  go: "version",
  javac: "-version",
  rustc: "--version",
};

function commandExists(cmd: string): Promise<boolean> {
  const flag = commandVersionFlags[cmd] ?? "--version";
  return new Promise((resolve) => {
    execFile(cmd, [flag], { timeout: 5_000 }, (err) => resolve(!err));
  });
}

const compilerCommands: Record<string, string> = {
  c: "gcc",
  cpp: "g++",
  go: "go",
  java: "javac",
  rust: "rustc",
};

type LangEntry = { source: string; language: SandboxInput["language"] };

const signalBasedMleLangs = new Set(["javascript", "python", "typescript"]);

function expectMleVerdict(languageName: string, verdict: string): void {
  if (process.platform === "win32" && signalBasedMleLangs.has(languageName)) {
    expect(["MLE", "RE"]).toContain(verdict);
    return;
  }

  expect(verdict).toBe("MLE");
}

async function skipIfMissing(name: string): Promise<boolean> {
  const compiler = compilerCommands[name];
  if (compiler && !(await commandExists(compiler))) return true;
  return false;
}

// ─── Program data ───────────────────────────────────────────────────

const correctPrograms: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <stdio.h>
int main() { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); return 0; }`,
  },
  cpp: {
    language: "cpp",
    source: `#include <iostream>
int main() { int a, b; std::cin >> a >> b; std::cout << a+b << '\\n'; }`,
  },
  go: {
    language: "go",
    source: `package main
import "fmt"
func main() {
	var a, b int
	fmt.Scan(&a, &b)
	fmt.Println(a + b)
}`,
  },
  java: {
    language: "java",
    source: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    System.out.println(sc.nextInt() + sc.nextInt());
  }
}`,
  },
  javascript: {
    language: "javascript",
    source: `import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const [a, b] = line.trim().split(" ").map(Number);
  console.log(a + b);
  rl.close();
});`,
  },
  python: {
    language: "python",
    source: `a, b = map(int, input().split())
print(a + b)`,
  },
  rust: {
    language: "rust",
    source: `use std::io;
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    let v: Vec<i32> = s.trim().split_whitespace().map(|x| x.parse().unwrap()).collect();
    println!("{}", v[0] + v[1]);
}`,
  },
  typescript: {
    language: "typescript",
    source: `import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  const [a, b]: number[] = line.trim().split(" ").map(Number);
  console.log(a + b);
  rl.close();
});`,
  },
};

const crashPrograms: Record<string, LangEntry> = {
  c: { language: "c", source: `#include <stdlib.h>\nint main() { abort(); }` },
  cpp: { language: "cpp", source: `int main() { throw 1; }` },
  go: { language: "go", source: `package main\nfunc main() { panic("crash") }` },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) { throw new RuntimeException(); }
}`,
  },
  javascript: { language: "javascript", source: `process.exit(1);` },
  python: { language: "python", source: `raise RuntimeError("crash")` },
  rust: { language: "rust", source: `fn main() { panic!("crash"); }` },
  typescript: { language: "typescript", source: `process.exit(1);` },
};

const tlePrograms: Record<string, LangEntry> = {
  c: { language: "c", source: `int main() { while(1) {} return 0; }` },
  cpp: { language: "cpp", source: `int main() { while(true) {} }` },
  go: { language: "go", source: `package main\nfunc main() { for {} }` },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) { while(true) {} }
}`,
  },
  javascript: { language: "javascript", source: `while(true) {}` },
  python: { language: "python", source: `while True: pass` },
  rust: { language: "rust", source: `fn main() { loop {} }` },
  typescript: { language: "typescript", source: `while(true) {}` },
};

const invalidSources: Record<string, LangEntry> = {
  c: { language: "c", source: "not valid C" },
  cpp: { language: "cpp", source: "not valid" },
  go: { language: "go", source: "not valid" },
  java: { language: "java", source: "not valid" },
  rust: { language: "rust", source: "not valid" },
};

/** Programs that self-SIGKILL to simulate OOM kill → MLE */
const mlePrograms: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <signal.h>
#include <unistd.h>
int main() { kill(getpid(), SIGKILL); return 0; }`,
  },
  cpp: {
    language: "cpp",
    source: `#include <csignal>
#include <unistd.h>
int main() { kill(getpid(), SIGKILL); return 0; }`,
  },
  go: {
    language: "go",
    source: `package main
import (
	"os"
	"syscall"
)
func main() {
	syscall.Kill(os.Getpid(), syscall.SIGKILL)
}`,
  },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) throws Exception {
    long pid = ProcessHandle.current().pid();
    Runtime.getRuntime().exec(new String[]{"kill", "-9", String.valueOf(pid)});
    while (true) {}
  }
}`,
  },
  javascript: { language: "javascript", source: `process.kill(process.pid, 'SIGKILL');` },
  python: {
    language: "python",
    source: `import os, signal
os.kill(os.getpid(), signal.SIGKILL)`,
  },
  rust: {
    language: "rust",
    source: `use std::process;
fn main() {
    let pid = process::id();
    process::Command::new("kill").args(["-9", &pid.to_string()]).spawn().unwrap();
    loop {}
}`,
  },
  typescript: { language: "typescript", source: `process.kill(process.pid, 'SIGKILL');` },
};

// ─── Helpers ────────────────────────────────────────────────────────

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

function makeInput(lang: SandboxInput["language"]): SandboxInput {
  return {
    submissionId: "test",
    language: lang,
    judgeType: "standard",
    problemType: "full_source",
    limits: { timeoutMs: TIMEOUT_MS, memoryMb: 256 },
  };
}

function makeTestcase(overrides: Partial<TestcaseFiles> = {}): TestcaseFiles {
  return { index: 0, input: "3 5\n", expected: "8\n", weight: 1, isSample: true, ...overrides };
}

async function compileProgram(lang: SandboxInput["language"], source: string) {
  const input = makeInput(lang);
  const srcFile = join(workDir, sourceFileName(lang));
  await writeFile(srcFile, source);
  return compile(input, srcFile, workDir);
}

// ─── Standard judge ─────────────────────────────────────────────────

describe("standard judge", () => {
  for (const [name, prog] of Object.entries(correctPrograms)) {
    it(
      `AC — ${name}`,
      async () => {
        if (await skipIfMissing(name)) return;
        const result = await compileProgram(prog.language, prog.source);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
        expect(verdict.verdict).toBe("AC");
      },
      name === "go" ? 90_000 : 30_000,
    );
  }

  for (const [name, prog] of Object.entries(correctPrograms)) {
    it(
      `WA — ${name}`,
      async () => {
        if (await skipIfMissing(name)) return;
        const result = await compileProgram(prog.language, prog.source);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const verdict = await judgeStandard(
          result.runCommand,
          makeTestcase({ expected: "999\n" }),
          TIMEOUT_MS,
        );
        expect(verdict.verdict).toBe("WA");
      },
      name === "go" ? 90_000 : 30_000,
    );
  }

  for (const [name, prog] of Object.entries(crashPrograms)) {
    it(
      `RE — ${name}`,
      async () => {
        if (await skipIfMissing(name)) return;
        const result = await compileProgram(prog.language, prog.source);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
        expect(verdict.verdict).toBe("RE");
      },
      name === "go" ? 90_000 : 30_000,
    );
  }

  for (const [name, prog] of Object.entries(tlePrograms)) {
    it(
      `TLE — ${name}`,
      async () => {
        if (await skipIfMissing(name)) return;
        const result = await compileProgram(prog.language, prog.source);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const verdict = await judgeStandard(
          result.runCommand,
          makeTestcase(),
          SHORT_TIMEOUT_MS,
        );
        expect(verdict.verdict).toBe("TLE");
      },
      name === "go" ? 90_000 : 30_000,
    );
  }

  for (const [name, prog] of Object.entries(invalidSources)) {
    it(`CE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toBeTruthy();
    });
  }

  for (const [name, prog] of Object.entries(mlePrograms)) {
    it(
      `MLE — ${name}`,
      async () => {
        if (await skipIfMissing(name)) return;
        const result = await compileProgram(prog.language, prog.source);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
        expectMleVerdict(name, verdict.verdict);
      },
      name === "go" ? 90_000 : 30_000,
    );
  }

  it("SE — invalid command", async () => {
    const verdict = await judgeStandard(["/nonexistent/binary"], makeTestcase(), TIMEOUT_MS);
    expect(verdict.verdict).toBe("SE");
  });
});

describe("standard judge edge cases", () => {
  it("empty expected and empty output → AC", async () => {
    const result = await compileProgram("python", `pass`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ input: "", expected: "" });
    const verdict = await judgeStandard(result.runCommand, tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("CRLF output matches LF expected → AC", async () => {
    // Python program that outputs CRLF
    const result = await compileProgram(
      "python",
      `import sys\nsys.stdout.write("hello\\r\\n")`,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ input: "", expected: "hello\n" });
    const verdict = await judgeStandard(result.runCommand, tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("trailing whitespace in output still matches if trimEnd matches", async () => {
    // Output with trailing newlines
    const result = await compileProgram("python", `print("8\\n\\n")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "8\n" });
    const verdict = await judgeStandard(result.runCommand, tc, TIMEOUT_MS);
    expect(verdict.verdict).toBe("AC");
  }, 30_000);

  it("score is 100 for AC, 0 for WA", async () => {
    const result = await compileProgram("python", `print(8)`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const acVerdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
    expect(acVerdict.score).toBe(100);

    const waVerdict = await judgeStandard(
      result.runCommand,
      makeTestcase({ expected: "999\n" }),
      TIMEOUT_MS,
    );
    expect(waVerdict.score).toBe(0);
  }, 30_000);
});
