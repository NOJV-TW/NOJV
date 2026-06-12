import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceFileNames, type JudgeScriptLanguage } from "@nojv/core";
import type { SandboxInput } from "./types.js";
import { createBoundedBuffer, pathExists, withProcessLimit } from "./utils.js";

const COMPILER_DIR = path.dirname(fileURLToPath(import.meta.url));
const WRAPPERS_DIR = path.resolve(COMPILER_DIR, "../assets/wrappers");

function loadWrapper(file: string): string {
  return readFileSync(path.join(WRAPPERS_DIR, file), "utf-8");
}

const PYTHON_VALIDATOR_WRAPPER = loadWrapper("python-validator.py");
const PYTHON_INTERACTOR_DOMJUDGE_WRAPPER = loadWrapper("python-interactor-domjudge.py");

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

  const outPath = path.join(workDir, "validator");
  return compileWithCommand(
    ["g++", "-O2", "-std=c++20", "-o", outPath, scriptPath],
    [outPath],
    workDir,
  );
}

export async function compileInteractor(
  scriptPath: string,
  language: JudgeScriptLanguage,
  workDir: string,
): Promise<CompileResult> {
  if (language === "python") {
    const userSource = await fs.readFile(scriptPath, "utf-8");
    const wrappedPath = path.join(workDir, "interactor.py");
    await fs.writeFile(
      wrappedPath,
      `${PYTHON_INTERACTOR_DOMJUDGE_WRAPPER}${userSource}`,
      "utf-8",
    );
    return { success: true, runCommand: ["python3", wrappedPath] };
  }

  const outPath = path.join(workDir, "interactor");
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
    const proc = spawn(wrappedCmd, wrappedArgs, {
      cwd: workDir,
      stdio: ["ignore", "ignore", "pipe"],
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
  results.sort((a, b) => a.localeCompare(b));
  return results;
}
