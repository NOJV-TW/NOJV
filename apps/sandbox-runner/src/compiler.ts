import { spawn } from "node:child_process";
import * as path from "node:path";
import { sourceFileNames } from "@nojv/sandbox";
import type { SandboxInput } from "./types.js";

export type CompileResult =
  | { success: true; runCommand: string[] }
  | { success: false; error: string };

/**
 * For function-mode submissions, inject user source code into the driver
 * template at the insertion marker position.
 */
export function assembleSource(userSource: string, input: SandboxInput): string {
  if (input.submissionType === "full_source") {
    return userSource;
  }

  if (!input.template) {
    throw new Error("Function-mode submission requires a template in config.json.");
  }

  if (!input.template.driverCode.includes(input.template.insertionMarker)) {
    throw new Error(
      `Driver code does not contain insertion marker "${input.template.insertionMarker}".`
    );
  }

  return input.template.driverCode.replace(input.template.insertionMarker, userSource);
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
    case "c":
      return compileWithCommand(
        ["gcc", "-O2", "-std=c17", "-o", path.join(workDir, "main"), sourcePath],
        [path.join(workDir, "main")],
        workDir
      );
    case "cpp":
      return compileWithCommand(
        ["g++", "-O2", "-std=c++20", "-o", path.join(workDir, "main"), sourcePath],
        [path.join(workDir, "main")],
        workDir
      );
    case "go":
      return compileWithCommand(
        ["go", "build", "-o", path.join(workDir, "main"), sourcePath],
        [path.join(workDir, "main")],
        workDir
      );
    case "java":
      return compileWithCommand(
        ["javac", "-d", workDir, sourcePath],
        ["java", "-cp", workDir, "Main"],
        workDir
      );
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
      timeout: 30_000
    });

    const stderrChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, runCommand });
      } else {
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
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
