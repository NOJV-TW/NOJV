import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sourceFileNames } from "@nojv/core";
import type { SandboxInput } from "./types.js";
import { createBoundedBuffer, pathExists } from "./utils.js";

export type CompileResult =
  | { success: true; runCommand: string[] }
  | { success: false; error: string };

/**
 * Phase 5: function-mode templates are gone. Student source is shipped
 * in full via `sourceFiles` from the workspace model. This helper is
 * kept as an identity function for any callers still on the legacy
 * code path.
 */
export function assembleSource(userSource: string, _input: SandboxInput): string {
  return userSource;
}

/** Returns the source file name for a given language. */
export function sourceFileName(language: SandboxInput["language"]): string {
  return sourceFileNames[language];
}

/**
 * Compile (if needed) and return the command to run the program.
 *
 * @param input      - Sandbox input config
 * @param sourcePath - Absolute path to the source file on disk
 * @param workDir    - Working directory for compilation output
 */
export async function compile(
  input: SandboxInput,
  sourcePath: string,
  workDir: string
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
          ...(cSources.length > 0 ? cSources : [sourcePath])
        ],
        [path.join(workDir, "main")],
        workDir
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
          ...(cppSources.length > 0 ? cppSources : [sourcePath])
        ],
        [path.join(workDir, "main")],
        workDir
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
        workDir
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
        workDir
      );
    case "typescript":
      return { success: true, runCommand: ["node", "--experimental-strip-types", sourcePath] };
  }
}

/**
 * Compile a checker or interactor script.
 *
 * @param scriptPath - Path to the script source file
 * @param language   - Language of the script (python, c, cpp, go, rust)
 * @param workDir    - Working directory for compilation output
 * @param outputName - Base name for the compiled binary (e.g. "checker" or "interactor")
 */
export async function compileChecker(
  scriptPath: string,
  language: string,
  workDir: string,
  outputName: string = "checker"
): Promise<CompileResult> {
  if (language === "python" || language === "python3") {
    return { success: true, runCommand: ["python3", scriptPath] };
  }

  const outPath = path.join(workDir, outputName);

  if (language === "c") {
    return compileWithCommand(
      ["gcc", "-O2", "-std=c17", "-o", outPath, scriptPath],
      [outPath],
      workDir
    );
  }

  if (language === "cpp") {
    return compileWithCommand(
      ["g++", "-O2", "-std=c++20", "-o", outPath, scriptPath],
      [outPath],
      workDir
    );
  }

  if (language === "go") {
    return compileWithCommand(["go", "build", "-o", outPath, scriptPath], [outPath], workDir);
  }

  if (language === "rust") {
    return compileWithCommand(["rustc", "-O", "-o", outPath, scriptPath], [outPath], workDir);
  }

  // Fallback: assume interpreted (Python)
  return { success: true, runCommand: ["python3", scriptPath] };
}

/** Spawn a compiler process and capture stderr on failure. */
function compileWithCommand(
  compileArgs: string[],
  runCommand: string[],
  workDir: string
): Promise<CompileResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = compileArgs;
    if (!cmd) {
      resolve({ success: false, error: "Empty compile command." });
      return;
    }

    const proc = spawn(cmd, args, {
      cwd: workDir,
      stdio: ["ignore", "ignore", "pipe"],
      // 90s accommodates Go/Rust/Java cold-start compiles on GitHub Actions
      // runners where toolchain cache priming can eat 30+ seconds. Local
      // warm builds finish in <5s regardless.
      timeout: 90_000
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
          error: stderr || `Compiler exited with code ${String(code ?? "unknown")}.`
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        error: `Failed to spawn compiler: ${err.message}`
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
