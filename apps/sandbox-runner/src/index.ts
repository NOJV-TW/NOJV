import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  SandboxInputSchema,
  type SandboxInput,
  type SandboxOutput,
  type TestcaseFiles,
  type TestcaseResult
} from "./types.js";
import { assembleSource, compile, compileChecker, sourceFileName } from "./compiler.js";
import { judgeStandard } from "./judges/standard.js";
import { judgeChecker } from "./judges/checker.js";
import { judgeInteractive } from "./judges/interactive.js";

const SUBMISSION_DIR = "/submission";

/** Log to stderr only — stdout is reserved for the JSON result. */
function log(message: string): void {
  process.stderr.write(`[sandbox-runner] ${message}\n`);
}

/** Read and parse the submission config. */
async function readConfig(): Promise<SandboxInput> {
  const raw = await fs.readFile(path.join(SUBMISSION_DIR, "config.json"), "utf-8");
  return SandboxInputSchema.parse(JSON.parse(raw));
}

/** Read the user's source code file. */
async function readSourceCode(language: SandboxInput["language"]): Promise<string> {
  const fileName = sourceFileName(language);
  return fs.readFile(path.join(SUBMISSION_DIR, fileName), "utf-8");
}

/**
 * Load testcases from either:
 * - Directory layout (Docker): /submission/testcases/{index}/input.txt
 * - Flat ConfigMap keys (K8s): /submission/testcase-{i}-input.txt
 */
async function loadTestcases(): Promise<TestcaseFiles[]> {
  const testcasesDir = path.join(SUBMISSION_DIR, "testcases");

  try {
    const entries = await fs.readdir(testcasesDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (dirs.length > 0) {
      return loadTestcasesFromDirs(testcasesDir, dirs);
    }
  } catch {
    // testcases/ directory doesn't exist — try flat ConfigMap layout
  }

  return loadTestcasesFromFlatKeys();
}

/** Docker volume mount layout: /submission/testcases/{index}/input.txt */
async function loadTestcasesFromDirs(
  testcasesDir: string,
  dirs: string[]
): Promise<TestcaseFiles[]> {
  const testcases: TestcaseFiles[] = [];

  for (const dirName of dirs) {
    const tcDir = path.join(testcasesDir, dirName);
    const index = parseInt(dirName, 10);

    const input = await fs.readFile(path.join(tcDir, "input.txt"), "utf-8");

    let expected: string | undefined;
    try {
      expected = await fs.readFile(path.join(tcDir, "expected.txt"), "utf-8");
    } catch {
      // expected is optional (e.g., for interactive/checker judges)
    }

    let meta: { weight?: number; isSample?: boolean } = {};
    try {
      const metaRaw = await fs.readFile(path.join(tcDir, "meta.json"), "utf-8");
      meta = JSON.parse(metaRaw) as typeof meta;
    } catch {
      // meta.json is optional, defaults below
    }

    testcases.push({
      index,
      input,
      expected,
      weight: meta.weight ?? 1,
      isSample: meta.isSample ?? false
    });
  }

  return testcases;
}

/** K8s ConfigMap layout: /submission/testcase-{i}-input.txt */
async function loadTestcasesFromFlatKeys(): Promise<TestcaseFiles[]> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const inputFiles = entries
    .filter((e) => e.match(/^testcase-\d+-input\.txt$/))
    .sort((a, b) => {
      const ai = parseInt(a.split("-")[1]!, 10);
      const bi = parseInt(b.split("-")[1]!, 10);
      return ai - bi;
    });

  const testcases: TestcaseFiles[] = [];

  for (const inputFile of inputFiles) {
    const index = parseInt(inputFile.split("-")[1]!, 10);
    const input = await fs.readFile(path.join(SUBMISSION_DIR, inputFile), "utf-8");

    let expected: string | undefined;
    try {
      expected = await fs.readFile(
        path.join(SUBMISSION_DIR, `testcase-${String(index)}-expected.txt`),
        "utf-8"
      );
    } catch {
      // expected is optional
    }

    testcases.push({ index, input, expected, weight: 1, isSample: false });
  }

  return testcases;
}

/** Find the checker or interactor script in /submission/. */
async function findScript(prefix: string): Promise<string | null> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const match = entries.find((e) => e.startsWith(`${prefix}.`));
  return match ? path.join(SUBMISSION_DIR, match) : null;
}

async function main(): Promise<void> {
  // 1. Read config
  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.submissionType}`
  );

  // 2. Read source code and assemble (function mode → inject into template)
  log("Reading source code...");
  const rawSource = await readSourceCode(config.language);

  let assembledSource: string;
  try {
    assembledSource = assembleSource(rawSource, config);
  } catch (err) {
    const output: SandboxOutput = {
      compilationError: err instanceof Error ? err.message : "Source assembly failed.",
      testcaseResults: []
    };
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // 3. Write assembled source to a work directory
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  const srcFile = path.join(workDir, sourceFileName(config.language));
  await fs.writeFile(srcFile, assembledSource);

  // 4. Compile source
  log("Compiling...");
  const compileResult = await compile(config, srcFile, workDir);

  if (!compileResult.success) {
    const output: SandboxOutput = {
      compilationError: compileResult.error,
      testcaseResults: []
    };
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // 5. If checker/interactive: compile checker/interactor
  let checkerCommand: string[] | undefined;
  let interactorCommand: string[] | undefined;

  if (config.judgeType === "checker") {
    const checkerPath = await findScript("checker");
    if (!checkerPath) {
      const output: SandboxOutput = {
        compilationError: "Checker judge requires a checker script in /submission/.",
        testcaseResults: []
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }

    const checkerLang = config.checkerLanguage ?? "python";
    const checkerResult = await compileChecker(checkerPath, checkerLang, workDir, "checker");
    if (!checkerResult.success) {
      const output: SandboxOutput = {
        compilationError: `Checker compilation failed: ${checkerResult.error ?? "unknown error"}`,
        testcaseResults: []
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
    checkerCommand = checkerResult.runCommand;
  }

  if (config.judgeType === "interactive") {
    const interactorPath = await findScript("interactor");
    if (!interactorPath) {
      const output: SandboxOutput = {
        compilationError: "Interactive judge requires an interactor script in /submission/.",
        testcaseResults: []
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }

    const interactorLang = config.interactorLanguage ?? config.checkerLanguage ?? "python";
    const interactorResult = await compileChecker(interactorPath, interactorLang, workDir, "interactor");
    if (!interactorResult.success) {
      const output: SandboxOutput = {
        compilationError: `Interactor compilation failed: ${interactorResult.error ?? "unknown error"}`,
        testcaseResults: []
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
    interactorCommand = interactorResult.runCommand;
  }

  // 6. Load testcases
  log("Loading testcases...");
  const testcases = await loadTestcases();
  log(`Found ${String(testcases.length)} testcase(s).`);

  // 7. Judge each testcase
  const results: TestcaseResult[] = [];

  for (const testcase of testcases) {
    log(`Judging testcase ${String(testcase.index)}...`);

    let result: TestcaseResult;

    switch (config.judgeType) {
      case "standard":
        result = await judgeStandard(
          compileResult.runCommand,
          testcase,
          config.limits.timeoutMs
        );
        break;

      case "checker":
        result = await judgeChecker(
          compileResult.runCommand,
          testcase,
          checkerCommand!,
          config.limits.timeoutMs
        );
        break;

      case "interactive":
        result = await judgeInteractive(
          compileResult.runCommand,
          testcase,
          interactorCommand!,
          config.limits.timeoutMs
        );
        break;
    }

    results.push(result);
    log(`Testcase ${String(testcase.index)}: ${result.verdict} (${String(result.timeMs)}ms)`);
  }

  // 8. Output JSON result to stdout
  const output: SandboxOutput = {
    testcaseResults: results
  };
  process.stdout.write(JSON.stringify(output));
}

// Run and handle any unhandled errors as SE
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[sandbox-runner] Fatal error: ${message}\n`);

  const output: SandboxOutput = {
    testcaseResults: [
      {
        index: 0,
        verdict: "SE",
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0
      }
    ]
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(1);
});
