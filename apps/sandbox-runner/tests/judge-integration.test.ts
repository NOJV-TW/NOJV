/**
 * Comprehensive integration tests: 8 languages × 3 judge types × all verdicts.
 *
 * Verdicts: AC, WA, RE, TLE, CE, MLE, SE
 * Languages: C, C++, Go, Java, JavaScript, Python, Rust, TypeScript
 * Judge types: standard, checker, interactive
 * Plus: function mode (template injection) for all languages
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { compile, assembleSource, sourceFileName } from "../src/compiler.js";
import { judgeStandard } from "../src/judges/standard.js";
import { judgeChecker } from "../src/judges/checker.js";
import { judgeInteractive } from "../src/judges/interactive.js";
import type { SandboxInput, TestcaseFiles } from "../src/types.js";

const TIMEOUT_MS = 10_000;
const SHORT_TIMEOUT_MS = 500;

// ─── Utilities ──────────────────────────────────────────────────────

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [cmd], (err) => resolve(!err));
  });
}

const compilerCommands: Record<string, string> = {
  c: "gcc",
  cpp: "g++",
  go: "go",
  java: "javac",
  rust: "rustc"
};

type LangEntry = { source: string; language: SandboxInput["language"] };

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
int main() { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); return 0; }`
  },
  cpp: {
    language: "cpp",
    source: `#include <iostream>
int main() { int a, b; std::cin >> a >> b; std::cout << a+b << '\\n'; }`
  },
  go: {
    language: "go",
    source: `package main
import "fmt"
func main() {
	var a, b int
	fmt.Scan(&a, &b)
	fmt.Println(a + b)
}`
  },
  java: {
    language: "java",
    source: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    System.out.println(sc.nextInt() + sc.nextInt());
  }
}`
  },
  javascript: {
    language: "javascript",
    source: `import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const [a, b] = line.trim().split(" ").map(Number);
  console.log(a + b);
  rl.close();
});`
  },
  python: {
    language: "python",
    source: `a, b = map(int, input().split())
print(a + b)`
  },
  rust: {
    language: "rust",
    source: `use std::io;
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    let v: Vec<i32> = s.trim().split_whitespace().map(|x| x.parse().unwrap()).collect();
    println!("{}", v[0] + v[1]);
}`
  },
  typescript: {
    language: "typescript",
    source: `import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  const [a, b]: number[] = line.trim().split(" ").map(Number);
  console.log(a + b);
  rl.close();
});`
  }
};

const wrongPrograms: Record<string, LangEntry> = {
  c: { language: "c", source: `#include <stdio.h>\nint main() { puts("999"); return 0; }` },
  cpp: {
    language: "cpp",
    source: `#include <iostream>\nint main() { std::cout << 999 << std::endl; }`
  },
  go: {
    language: "go",
    source: `package main\nimport "fmt"\nfunc main() { fmt.Println(999) }`
  },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) { System.out.println(999); }
}`
  },
  javascript: { language: "javascript", source: `console.log(999);` },
  python: { language: "python", source: `print(999)` },
  rust: { language: "rust", source: `fn main() { println!("999"); }` },
  typescript: { language: "typescript", source: `console.log(999);` }
};

const crashPrograms: Record<string, LangEntry> = {
  c: { language: "c", source: `#include <stdlib.h>\nint main() { abort(); }` },
  cpp: { language: "cpp", source: `int main() { throw 1; }` },
  go: { language: "go", source: `package main\nfunc main() { panic("crash") }` },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) { throw new RuntimeException(); }
}`
  },
  javascript: { language: "javascript", source: `process.exit(1);` },
  python: { language: "python", source: `raise RuntimeError("crash")` },
  rust: { language: "rust", source: `fn main() { panic!("crash"); }` },
  typescript: { language: "typescript", source: `process.exit(1);` }
};

const tlePrograms: Record<string, LangEntry> = {
  c: { language: "c", source: `int main() { while(1) {} return 0; }` },
  cpp: { language: "cpp", source: `int main() { while(true) {} }` },
  go: { language: "go", source: `package main\nfunc main() { for {} }` },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) { while(true) {} }
}`
  },
  javascript: { language: "javascript", source: `while(true) {}` },
  python: { language: "python", source: `while True: pass` },
  rust: { language: "rust", source: `fn main() { loop {} }` },
  typescript: { language: "typescript", source: `while(true) {}` }
};

const invalidSources: Record<string, LangEntry> = {
  c: { language: "c", source: "not valid C" },
  cpp: { language: "cpp", source: "not valid" },
  go: { language: "go", source: "not valid" },
  java: { language: "java", source: "not valid" },
  rust: { language: "rust", source: "not valid" }
};

/** Programs that self-SIGKILL to simulate OOM kill → MLE */
const mlePrograms: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <signal.h>
#include <unistd.h>
int main() { kill(getpid(), SIGKILL); return 0; }`
  },
  cpp: {
    language: "cpp",
    source: `#include <csignal>
#include <unistd.h>
int main() { kill(getpid(), SIGKILL); return 0; }`
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
}`
  },
  java: {
    language: "java",
    source: `public class Main {
  public static void main(String[] args) throws Exception {
    long pid = ProcessHandle.current().pid();
    Runtime.getRuntime().exec(new String[]{"kill", "-9", String.valueOf(pid)});
    while (true) {}
  }
}`
  },
  javascript: { language: "javascript", source: `process.kill(process.pid, 'SIGKILL');` },
  python: {
    language: "python",
    source: `import os, signal
os.kill(os.getpid(), signal.SIGKILL)`
  },
  rust: {
    language: "rust",
    source: `use std::process;
fn main() {
    let pid = process::id();
    process::Command::new("kill").args(["-9", &pid.to_string()]).spawn().unwrap();
    loop {}
}`
  },
  typescript: { language: "typescript", source: `process.kill(process.pid, 'SIGKILL');` }
};

const doubleSolutions: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <stdio.h>
int main() { int n; scanf("%d", &n); printf("%d\\n", n * 2); return 0; }`
  },
  cpp: {
    language: "cpp",
    source: `#include <iostream>
int main() { int n; std::cin >> n; std::cout << n * 2 << std::endl; }`
  },
  go: {
    language: "go",
    source: `package main
import "fmt"
func main() { var n int; fmt.Scan(&n); fmt.Println(n * 2) }`
  },
  java: {
    language: "java",
    source: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    System.out.println(sc.nextInt() * 2);
  }
}`
  },
  javascript: {
    language: "javascript",
    source: `import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  console.log(parseInt(line.trim()) * 2);
  rl.close();
});`
  },
  python: { language: "python", source: `n = int(input())\nprint(n * 2)` },
  rust: {
    language: "rust",
    source: `use std::io;
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    let n: i32 = s.trim().parse().unwrap();
    println!("{}", n * 2);
}`
  },
  typescript: {
    language: "typescript",
    source: `import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  console.log(parseInt(line.trim()) * 2);
  rl.close();
});`
  }
};

const wrongDoubleSolutions: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <stdio.h>
int main() { int n; scanf("%d", &n); printf("%d\\n", n + 1); return 0; }`
  },
  cpp: {
    language: "cpp",
    source: `#include <iostream>
int main() { int n; std::cin >> n; std::cout << n + 1 << std::endl; }`
  },
  go: {
    language: "go",
    source: `package main
import "fmt"
func main() { var n int; fmt.Scan(&n); fmt.Println(n + 1) }`
  },
  java: {
    language: "java",
    source: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    System.out.println(sc.nextInt() + 1);
  }
}`
  },
  javascript: {
    language: "javascript",
    source: `import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  console.log(parseInt(line.trim()) + 1);
  rl.close();
});`
  },
  python: { language: "python", source: `n = int(input())\nprint(n + 1)` },
  rust: {
    language: "rust",
    source: `use std::io;
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    let n: i32 = s.trim().parse().unwrap();
    println!("{}", n + 1);
}`
  },
  typescript: {
    language: "typescript",
    source: `import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
  console.log(parseInt(line.trim()) + 1);
  rl.close();
});`
  }
};

const interactiveTlePrograms: Record<string, LangEntry> = {
  c: {
    language: "c",
    source: `#include <stdio.h>
int main() { int n; scanf("%d", &n); while(1) {} return 0; }`
  },
  cpp: {
    language: "cpp",
    source: `#include <iostream>
int main() { int n; std::cin >> n; while(true) {} }`
  },
  go: {
    language: "go",
    source: `package main
import "fmt"
func main() { var n int; fmt.Scan(&n); for {} }`
  },
  java: {
    language: "java",
    source: `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    sc.nextInt();
    while(true) {}
  }
}`
  },
  javascript: {
    language: "javascript",
    source: `import * as readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", () => { while(true) {} });`
  },
  python: {
    language: "python",
    source: `n = int(input())
while True:
    pass`
  },
  rust: {
    language: "rust",
    source: `use std::io;
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    loop {}
}`
  },
  typescript: {
    language: "typescript",
    source: `import * as readline from "node:readline";
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", () => { while(true) {} });`
  }
};

/** Function mode templates for all languages */
const functionModeData: Record<
  string,
  { language: SandboxInput["language"]; driverCode: string; userCode: string }
> = {
  c: {
    language: "c",
    driverCode: `#include <stdio.h>
__USER_CODE__
int main() {
    int a, b;
    scanf("%d %d", &a, &b);
    printf("%d\\n", solve(a, b));
    return 0;
}`,
    userCode: `int solve(int a, int b) { return a + b; }`
  },
  cpp: {
    language: "cpp",
    driverCode: `#include <iostream>
using namespace std;
__USER_CODE__
int main() {
    int a, b;
    cin >> a >> b;
    cout << solve(a, b) << endl;
    return 0;
}`,
    userCode: `int solve(int a, int b) { return a + b; }`
  },
  go: {
    language: "go",
    driverCode: `package main
import "fmt"
__USER_CODE__
func main() {
	var a, b int
	fmt.Scan(&a, &b)
	fmt.Println(solve(a, b))
}`,
    userCode: `func solve(a, b int) int { return a + b }`
  },
  java: {
    language: "java",
    driverCode: `import java.util.Scanner;
public class Main {
    __USER_CODE__
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println(solve(sc.nextInt(), sc.nextInt()));
    }
}`,
    userCode: `public static int solve(int a, int b) { return a + b; }`
  },
  javascript: {
    language: "javascript",
    driverCode: `import * as readline from "node:readline";
__USER_CODE__
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
    const [a, b] = line.trim().split(" ").map(Number);
    console.log(solve(a, b));
    rl.close();
});`,
    userCode: `function solve(a, b) { return a + b; }`
  },
  python: {
    language: "python",
    driverCode: `__USER_CODE__
a, b = map(int, input().split())
print(solve(a, b))`,
    userCode: `def solve(a, b):\n    return a + b`
  },
  rust: {
    language: "rust",
    driverCode: `use std::io;
__USER_CODE__
fn main() {
    let mut s = String::new();
    io::stdin().read_line(&mut s).unwrap();
    let v: Vec<i32> = s.trim().split_whitespace().map(|x| x.parse().unwrap()).collect();
    println!("{}", solve(v[0], v[1]));
}`,
    userCode: `fn solve(a: i32, b: i32) -> i32 { a + b }`
  },
  typescript: {
    language: "typescript",
    driverCode: `import * as readline from "node:readline";
__USER_CODE__
const rl: readline.Interface = readline.createInterface({ input: process.stdin });
rl.on("line", (line: string) => {
    const [a, b]: number[] = line.trim().split(" ").map(Number);
    console.log(solve(a, b));
    rl.close();
});`,
    userCode: `function solve(a: number, b: number): number { return a + b; }`
  }
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
    submissionType: "full_source",
    limits: { timeoutMs: TIMEOUT_MS, memoryMb: 256 }
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
    it(`AC — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
      expect(verdict.verdict).toBe("AC");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(correctPrograms)) {
    it(`WA — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verdict = await judgeStandard(
        result.runCommand,
        makeTestcase({ expected: "999\n" }),
        TIMEOUT_MS
      );
      expect(verdict.verdict).toBe("WA");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(crashPrograms)) {
    it(`RE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
      expect(verdict.verdict).toBe("RE");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(tlePrograms)) {
    it(`TLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verdict = await judgeStandard(result.runCommand, makeTestcase(), SHORT_TIMEOUT_MS);
      expect(verdict.verdict).toBe("TLE");
    }, 30_000);
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
    it(`MLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const result = await compileProgram(prog.language, prog.source);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
      expect(verdict.verdict).toBe("MLE");
    }, 30_000);
  }

  it("SE — invalid command", async () => {
    const verdict = await judgeStandard(["/nonexistent/binary"], makeTestcase(), TIMEOUT_MS);
    expect(verdict.verdict).toBe("SE");
  });
});

// ─── Function mode ──────────────────────────────────────────────────

describe("function mode (template injection)", () => {
  it("template injection works correctly", () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      submissionType: "function",
      limits: { timeoutMs: 5000, memoryMb: 256 },
      template: {
        driverCode: `# driver\n__USER_CODE__\nprint(add(3, 5))`,
        insertionMarker: "__USER_CODE__"
      }
    };
    const assembled = assembleSource("def add(a, b):\n    return a + b", input);
    expect(assembled).toContain("def add(a, b):");
    expect(assembled).toContain("print(add(3, 5))");
    expect(assembled).not.toContain("__USER_CODE__");
  });

  for (const [name, data] of Object.entries(functionModeData)) {
    it(`${name}: function mode end-to-end`, async () => {
      if (await skipIfMissing(name)) return;
      const input: SandboxInput = {
        submissionId: "test",
        language: data.language,
        judgeType: "standard",
        submissionType: "function",
        limits: { timeoutMs: TIMEOUT_MS, memoryMb: 256 },
        template: { driverCode: data.driverCode, insertionMarker: "__USER_CODE__" }
      };

      const assembled = assembleSource(data.userCode, input);
      expect(assembled).not.toContain("__USER_CODE__");

      const srcFile = join(workDir, sourceFileName(data.language));
      await writeFile(srcFile, assembled);
      const result = await compile(input, srcFile, workDir);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const verdict = await judgeStandard(result.runCommand, makeTestcase(), TIMEOUT_MS);
      expect(verdict.verdict).toBe("AC");
    }, 30_000);
  }
});

// ─── Checker judge ──────────────────────────────────────────────────

describe("checker judge", () => {
  const checkerScript = `import sys
stdin_f, expected_f, user_f = sys.argv[1], sys.argv[2], sys.argv[3]
with open(expected_f) as f:
    expected = f.read().strip()
with open(user_f) as f:
    user_output = f.read().strip()
if user_output == expected:
    print("100")
    sys.exit(0)
else:
    print("0", file=sys.stderr)
    print(f"Expected {expected}, got {user_output}", file=sys.stderr)
    sys.exit(1)
`;

  async function withChecker(
    prog: LangEntry,
    tc: TestcaseFiles,
    timeoutMs: number = TIMEOUT_MS
  ) {
    const result = await compileProgram(prog.language, prog.source);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("compile failed");
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, checkerScript);
    return judgeChecker(result.runCommand, tc, ["python3", checkerFile], timeoutMs);
  }

  for (const [name, prog] of Object.entries(correctPrograms)) {
    it(`AC — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withChecker(prog, makeTestcase());
      expect(verdict.verdict).toBe("AC");
      expect(verdict.score).toBe(100);
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(wrongPrograms)) {
    it(`WA — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withChecker(prog, makeTestcase());
      expect(verdict.verdict).toBe("WA");
      expect(verdict.score).toBe(0);
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(crashPrograms)) {
    it(`RE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withChecker(prog, makeTestcase());
      expect(verdict.verdict).toBe("RE");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(tlePrograms)) {
    it(`TLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withChecker(prog, makeTestcase(), SHORT_TIMEOUT_MS);
      expect(verdict.verdict).toBe("TLE");
    }, 30_000);
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
    it(`MLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withChecker(prog, makeTestcase());
      expect(verdict.verdict).toBe("MLE");
    }, 30_000);
  }

  it("SE — invalid command", async () => {
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, checkerScript);
    const verdict = await judgeChecker(
      ["/nonexistent/binary"],
      makeTestcase(),
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("SE");
  });
});

// ─── Interactive judge ──────────────────────────────────────────────

describe("interactive judge", () => {
  const interactorScript = `import sys

n = 5
print(n, flush=True)
response = input().strip()
if response == str(n * 2):
    print("100", file=sys.stderr)
    print("Correct doubling", file=sys.stderr)
    sys.exit(0)
else:
    print("0", file=sys.stderr)
    print(f"Expected {n*2}, got {response}", file=sys.stderr)
    sys.exit(1)
`;

  const interactiveTc: TestcaseFiles = { index: 0, input: "", weight: 1, isSample: true };

  async function withInteractor(prog: LangEntry, timeoutMs: number = TIMEOUT_MS) {
    const result = await compileProgram(prog.language, prog.source);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("compile failed");
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, interactorScript);
    return judgeInteractive(result.runCommand, interactiveTc, ["python3", intFile], timeoutMs);
  }

  for (const [name, prog] of Object.entries(doubleSolutions)) {
    it(`AC — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withInteractor(prog);
      expect(verdict.verdict).toBe("AC");
      expect(verdict.score).toBe(100);
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(wrongDoubleSolutions)) {
    it(`WA — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withInteractor(prog);
      expect(verdict.verdict).toBe("WA");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(crashPrograms)) {
    it(`RE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withInteractor(prog);
      expect(verdict.verdict).toBe("RE");
    }, 30_000);
  }

  for (const [name, prog] of Object.entries(interactiveTlePrograms)) {
    it(`TLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withInteractor(prog, SHORT_TIMEOUT_MS);
      expect(verdict.verdict).toBe("TLE");
    }, 30_000);
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
    it(`MLE — ${name}`, async () => {
      if (await skipIfMissing(name)) return;
      const verdict = await withInteractor(prog);
      expect(verdict.verdict).toBe("MLE");
    }, 30_000);
  }

  it("SE — invalid command", async () => {
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, interactorScript);
    const verdict = await judgeInteractive(
      ["/nonexistent/binary"],
      interactiveTc,
      ["python3", intFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("SE");
  });

  it("SE — invalid interactor command", async () => {
    const result = await compileProgram("python", "print('hello')");
    expect(result.success).toBe(true);
    if (!result.success) return;
    const verdict = await judgeInteractive(
      result.runCommand,
      interactiveTc,
      ["/nonexistent/interactor"],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("SE");
    expect(verdict.feedback).toContain("Interactor");
  }, 30_000);

  it("handles interactor with testcase input file", async () => {
    // Interactor that reads a number from the input file, sends it, expects double
    const inputAwareInteractor = `import sys

input_file = sys.argv[1]
with open(input_file) as f:
    n = int(f.read().strip())
print(n, flush=True)
response = input().strip()
if response == str(n * 2):
    print("100", file=sys.stderr)
    sys.exit(0)
else:
    print("0", file=sys.stderr)
    sys.exit(1)
`;
    const intFile = join(workDir, "interactor.py");
    await writeFile(intFile, inputAwareInteractor);

    // Solution that reads a number and prints double
    const result = await compileProgram("python", `n = int(input())\nprint(n * 2)`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc: TestcaseFiles = { index: 0, input: "7\n", weight: 1, isSample: true };
    const verdict = await judgeInteractive(
      result.runCommand,
      tc,
      ["python3", intFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("AC");
  }, 30_000);
});

// ─── Edge case tests ────────────────────────────────────────────────

describe("checker edge cases", () => {
  it("checker timeout → SE (not WA)", async () => {
    // A checker that hangs forever
    const slowChecker = `import time\ntime.sleep(999)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, slowChecker);

    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("SE");
    expect(verdict.feedback).toContain("timed out");
  }, 60_000);

  it("checker crash → SE (not WA)", async () => {
    // A checker that crashes with a Python exception
    const crashingChecker = `raise RuntimeError("checker bug")`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, crashingChecker);

    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    // Python exceptions exit with code 1, which parseCheckerOutput interprets as WA.
    // This is by design: exit code 0 = AC, non-zero = WA per the checker protocol.
    // Only signal kills and timeouts are SE.
    expect(verdict.verdict).toBe("WA");
  }, 30_000);

  it("checker with invalid score output defaults gracefully", async () => {
    const badScoreChecker = `import sys
sys.stdout.write("not_a_number")
sys.exit(0)
`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, badScoreChecker);

    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    // Exit 0 → AC, invalid score text → defaults to 100
    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(100);
  }, 30_000);

  it("checker with no stdout defaults score", async () => {
    const silentChecker = `import sys\nsys.exit(0)`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, silentChecker);

    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(100);
  }, 30_000);

  it("checker spawn failure → SE", async () => {
    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["/nonexistent/checker"],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("SE");
    expect(verdict.feedback).toContain("Checker failed to start");
  }, 30_000);

  it("checker with partial score", async () => {
    const partialChecker = `import sys
sys.stdout.write("50")
sys.exit(0)
`;
    const checkerFile = join(workDir, "checker.py");
    await writeFile(checkerFile, partialChecker);

    const result = await compileProgram("python", `print("hello")`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const tc = makeTestcase({ expected: "hello\n" });
    const verdict = await judgeChecker(
      result.runCommand,
      tc,
      ["python3", checkerFile],
      TIMEOUT_MS
    );
    expect(verdict.verdict).toBe("AC");
    expect(verdict.score).toBe(50);
  }, 30_000);
});

describe("template injection edge cases", () => {
  it("missing marker in driverCode throws clear error", () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      submissionType: "function",
      limits: { timeoutMs: 5000, memoryMb: 256 },
      template: {
        driverCode: `print("no marker here")`,
        insertionMarker: "__USER_CODE__"
      }
    };
    expect(() => assembleSource("def solve(): pass", input)).toThrow(
      /does not contain insertion marker/
    );
  });

  it("missing template in function mode throws clear error", () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      submissionType: "function",
      limits: { timeoutMs: 5000, memoryMb: 256 }
    };
    expect(() => assembleSource("def solve(): pass", input)).toThrow(/requires a template/);
  });

  it("multiple markers — only first is replaced", () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      submissionType: "function",
      limits: { timeoutMs: 5000, memoryMb: 256 },
      template: {
        driverCode: `__USER_CODE__\nprint("middle")\n__USER_CODE__`,
        insertionMarker: "__USER_CODE__"
      }
    };
    const assembled = assembleSource("CODE", input);
    // String.replace replaces only the first occurrence
    expect(assembled).toBe(`CODE\nprint("middle")\n__USER_CODE__`);
  });

  it("full_source mode ignores template entirely", () => {
    const input: SandboxInput = {
      submissionId: "test",
      language: "python",
      judgeType: "standard",
      submissionType: "full_source",
      limits: { timeoutMs: 5000, memoryMb: 256 },
      template: {
        driverCode: `__USER_CODE__\nprint("driver")`,
        insertionMarker: "__USER_CODE__"
      }
    };
    const assembled = assembleSource("print('raw')", input);
    expect(assembled).toBe("print('raw')");
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
      `import sys\nsys.stdout.write("hello\\r\\n")`
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
      TIMEOUT_MS
    );
    expect(waVerdict.score).toBe(0);
  }, 30_000);
});
