import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFileNames, type JudgeScriptLanguage } from "@nojv/core";
import type { SandboxInput } from "./types.js";
import { createBoundedBuffer, pathExists, withProcessLimit } from "./utils.js";

// Wrapper assets live at `apps/sandbox-runner/assets/wrappers/` in source
// and at `<runtime-prefix>/assets/wrappers/` in the built sandbox image
// (the Dockerfile copies `apps/sandbox-runner/assets/` next to `dist/`).
// Resolving as `<thisDir>/../assets/wrappers/<file>` works for both:
//   - src layout: <repo>/apps/sandbox-runner/src/compiler.ts → ../assets/...
//   - dist layout: /runner/compiler.js → /assets/wrappers/... (when the
//     runtime prefix is `/runner` and assets are mounted at `/assets`).
const COMPILER_DIR = path.dirname(fileURLToPath(import.meta.url));
const WRAPPERS_DIR = path.resolve(COMPILER_DIR, "../assets/wrappers");

function loadWrapper(file: string): string {
  return readFileSync(path.join(WRAPPERS_DIR, file), "utf-8");
}

// Cached at module load — wrapper content is static and small.
const PYTHON_CHECKER_WRAPPER = loadWrapper("python-checker.py");
const PYTHON_INTERACTOR_WRAPPER = loadWrapper("python-interactor.py");
const PYTHON_VALIDATOR_WRAPPER = loadWrapper("python-validator.py");

export type ScriptMode = "checker" | "interactor";

export type CompileResult =
  | { success: true; runCommand: string[] }
  | { success: false; error: string };

export function sourceFileName(language: SandboxInput["language"]): string {
  return sourceFileNames[language];
}

export async function compile(
  input: SandboxInput,
  sourcePath: string,
  workDir: string,
): Promise<CompileResult> {
  switch (input.language) {
    case "c": {
      const cSources = await collectSourceFiles(workDir, [".c"]);
      return compileWithCommand(
        [
          "gcc",
          "-O2",
          "-std=c17",
          "-o",
          path.join(workDir, "main"),
          ...(cSources.length > 0 ? cSources : [sourcePath]),
        ],
        [path.join(workDir, "main")],
        workDir,
      );
    }
    case "cpp": {
      const cppSources = await collectSourceFiles(workDir, [".cpp", ".cc", ".cxx", ".c++"]);
      return compileWithCommand(
        [
          "g++",
          "-O2",
          "-std=c++20",
          "-o",
          path.join(workDir, "main"),
          ...(cppSources.length > 0 ? cppSources : [sourcePath]),
        ],
        [path.join(workDir, "main")],
        workDir,
      );
    }
    case "go": {
      const goSources = await collectSourceFiles(workDir, [".go"]);
      const hasGoMod = await pathExists(path.join(workDir, "go.mod"));
      const goCompileCommand =
        hasGoMod || goSources.length > 1
          ? ["go", "build", "-o", path.join(workDir, "main"), "."]
          : ["go", "build", "-o", path.join(workDir, "main"), sourcePath];

      return compileWithCommand(goCompileCommand, [path.join(workDir, "main")], workDir);
    }
    case "java": {
      const javaSources = await collectSourceFiles(workDir, [".java"]);
      return compileWithCommand(
        ["javac", "-d", workDir, ...(javaSources.length > 0 ? javaSources : [sourcePath])],
        ["java", "-cp", workDir, "Main"],
        workDir,
      );
    }
    case "javascript":
      return { success: true, runCommand: ["node", sourcePath] };
    case "python":
      return { success: true, runCommand: ["python3", sourcePath] };
    case "rust":
      return compileWithCommand(
        ["rustc", "-O", "-o", path.join(workDir, "main"), sourcePath],
        [path.join(workDir, "main")],
        workDir,
      );
    case "typescript":
      return { success: true, runCommand: ["node", "--experimental-strip-types", sourcePath] };
  }
}

/**
 * Compile (or prepare) a checker / interactor script. Only Python and C++
 * are supported — the schema enforces this at the edge.
 *
 * Python: the user-supplied source is concatenated after a fixed wrapper
 * that exposes `judge_input`, `judge_output`, `process_output` (checker)
 * or `judge_input`, `read`, `write` (interactor) plus `accept` / `reject`
 * / `partial` helpers. The wrapped file is written next to the original
 * and run via `python3`.
 *
 * C++: compiled with `g++ -O2 -std=c++20`. `testlib.h` is installed
 * globally in the sandbox image (`/usr/include/testlib.h`) so user code
 * can `#include "testlib.h"` directly without extra include paths.
 */
export async function compileChecker(
  scriptPath: string,
  language: JudgeScriptLanguage,
  workDir: string,
  mode: ScriptMode,
): Promise<CompileResult> {
  if (language === "python") {
    const userSource = await fs.readFile(scriptPath, "utf-8");
    const wrapper = mode === "checker" ? PYTHON_CHECKER_WRAPPER : PYTHON_INTERACTOR_WRAPPER;
    const wrappedPath = path.join(workDir, `${mode}.py`);
    await fs.writeFile(wrappedPath, `${wrapper}${userSource}`, "utf-8");
    return { success: true, runCommand: ["python3", wrappedPath] };
  }

  // language === "cpp"
  const outPath = path.join(workDir, mode);
  return compileWithCommand(
    ["g++", "-O2", "-std=c++20", "-o", outPath, scriptPath],
    [outPath],
    workDir,
  );
}

/**
 * Compile (or prepare) a DOMjudge output validator. Invoked as
 * `validator <input_file> <judge_answer_file> <feedback_dir>` with the team
 * output on stdin; exit 42 = accept, 43 = wrong, else = validator/system error.
 *
 * Python: the TA source is concatenated after a fixed wrapper that exposes
 * `judge_input`, `judge_answer`, `feedback_dir`, `team_output` plus
 * `accept` / `wrong` / `set_score` / `judge_log` helpers.
 *
 * C++: compiled with `g++ -O2 -std=c++20` and NO testlib — the DOMjudge
 * interface is plain argv/stdin/feedback-files, so no header is required.
 */
export async function compileValidator(
  scriptPath: string,
  language: JudgeScriptLanguage,
  workDir: string,
): Promise<CompileResult> {
  if (language === "python") {
    const userSource = await fs.readFile(scriptPath, "utf-8");
    const wrappedPath = path.join(workDir, "validator.py");
    await fs.writeFile(wrappedPath, `${PYTHON_VALIDATOR_WRAPPER}${userSource}`, "utf-8");
    return { success: true, runCommand: ["python3", wrappedPath] };
  }

  // language === "cpp"
  const outPath = path.join(workDir, "validator");
  return compileWithCommand(
    ["g++", "-O2", "-std=c++20", "-o", outPath, scriptPath],
    [outPath],
    workDir,
  );
}

function compileWithCommand(
  compileArgs: string[],
  runCommand: string[],
  workDir: string,
): Promise<CompileResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = compileArgs;
    if (!cmd) {
      resolve({ success: false, error: "Empty compile command." });
      return;
    }

    const [wrappedCmd, ...wrappedArgs] = withProcessLimit([cmd, ...args]);
    const proc = spawn(wrappedCmd!, wrappedArgs, {
      cwd: workDir,
      stdio: ["ignore", "ignore", "pipe"],
      // 90s covers Go/Rust/Java cold compiles on CI where toolchain priming can eat 30s+.
      timeout: 90_000,
    });

    const stderrBuf = createBoundedBuffer();
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf.push(chunk);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, runCommand });
      } else {
        const stderr = stderrBuf.toString().trim();
        resolve({
          success: false,
          error: stderr || `Compiler exited with code ${String(code ?? "unknown")}.`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to spawn compiler: ${err.message}`,
      });
    });
  });
}

async function collectSourceFiles(baseDir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  };

  await walk(baseDir);
  results.sort();
  return results;
}
