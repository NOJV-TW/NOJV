import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  SandboxInputSchema,
  TestcaseMetaSchema,
  type SandboxInput,
  type SandboxOutput,
  type TestcaseFiles,
  type TestcaseMeta,
  type TestcaseResult,
} from "./types.js";
import { compile, compileChecker, sourceFileName } from "./compiler.js";
import { cleanupTempDir, pathExists } from "./utils.js";
import { judgeStandard } from "./judges/standard.js";
import { judgeChecker } from "./judges/checker.js";
import { judgeInteractive } from "./judges/interactive.js";
import { normalizeRelativePath } from "@nojv/core";

const SUBMISSION_DIR = "/submission";
const DEFAULT_TESTCASE_META = { weight: 1, isSample: false } as const;

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
async function readSourceCode(
  language: SandboxInput["language"],
  entryFile?: string,
): Promise<string> {
  const fileCandidates = [entryFile, sourceFileName(language)].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );

  for (const fileName of fileCandidates) {
    try {
      return await fs.readFile(path.join(SUBMISSION_DIR, fileName), "utf-8");
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Source file not found. Tried: ${fileCandidates.join(", ")}`);
}

async function writeWorkFile(
  workDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(workDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function materializeConfiguredSources(
  config: SandboxInput,
  workDir: string,
): Promise<void> {
  for (const sourceFile of config.sourceFiles ?? []) {
    const normalizedPath = normalizeRelativePath(sourceFile.path);
    if (!normalizedPath) {
      continue;
    }
    await writeWorkFile(workDir, normalizedPath, sourceFile.content);
  }

  for (const fileRef of config.sourceFileMap ?? []) {
    const normalizedPath = normalizeRelativePath(fileRef.path);
    const normalizedKey = normalizeRelativePath(fileRef.key);
    if (!normalizedPath || !normalizedKey) {
      continue;
    }

    try {
      const content = await fs.readFile(path.join(SUBMISSION_DIR, normalizedKey), "utf-8");
      await writeWorkFile(workDir, normalizedPath, content);
    } catch {
      // Ignore missing mapped entries and continue with available files.
    }
  }
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
  dirs: string[],
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

    let meta: TestcaseMeta = {};
    try {
      const metaRaw = await fs.readFile(path.join(tcDir, "meta.json"), "utf-8");
      const parsed = TestcaseMetaSchema.safeParse(JSON.parse(metaRaw));
      if (parsed.success) meta = parsed.data;
      // If parsing fails (malformed JSON or wrong shape), fall through to
      // defaults below — meta.json is advisory, not load-bearing.
    } catch {
      // meta.json is optional, defaults below
    }

    testcases.push({
      index,
      input,
      expected,
      weight: meta.weight ?? DEFAULT_TESTCASE_META.weight,
      isSample: meta.isSample ?? DEFAULT_TESTCASE_META.isSample,
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
        "utf-8",
      );
    } catch {
      // expected is optional
    }

    testcases.push({ index, input, expected, ...DEFAULT_TESTCASE_META });
  }

  return testcases;
}

/** Find the checker or interactor script in /submission/. */
async function findScript(prefix: string): Promise<string | null> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const match = entries.find((e) => e.startsWith(`${prefix}.`));
  return match ? path.join(SUBMISSION_DIR, match) : null;
}

/** Write a SandboxOutput to stdout. */
function emit(overrides: Partial<SandboxOutput>): void {
  const output: SandboxOutput = {
    testcaseResults: [],
    ...overrides,
  };
  process.stdout.write(JSON.stringify(output));
}

async function runJudge(workDir: string, config: SandboxInput): Promise<void> {
  await materializeConfiguredSources(config, workDir);

  const defaultEntry = sourceFileName(config.language);
  const entryFile =
    (config.entryFile && normalizeRelativePath(config.entryFile)) ?? defaultEntry;
  const srcFile = path.join(workDir, entryFile);

  if (!(await pathExists(srcFile))) {
    log("Reading source code...");
    const rawSource = await readSourceCode(config.language, entryFile);
    await writeWorkFile(workDir, entryFile, rawSource);
  }

  log("Compiling...");
  const compileResult = await compile(config, srcFile, workDir);

  if (!compileResult.success) {
    emit({ compilationError: compileResult.error });
    return;
  }

  let checkerCommand: string[] | undefined;
  let interactorCommand: string[] | undefined;

  if (config.judgeType === "checker") {
    const checkerPath = await findScript("checker");
    if (!checkerPath) {
      emit({
        compilationError: "Checker judge requires a checker script in /submission/.",
      });
      return;
    }

    const checkerLang = config.checkerLanguage ?? "python";
    const checkerResult = await compileChecker(checkerPath, checkerLang, workDir, "checker");
    if (!checkerResult.success) {
      emit({
        compilationError: `Checker compilation failed: ${checkerResult.error ?? "unknown error"}`,
      });
      return;
    }
    checkerCommand = checkerResult.runCommand;
  }

  if (config.judgeType === "interactive") {
    const interactorPath = await findScript("interactor");
    if (!interactorPath) {
      emit({
        compilationError: "Interactive judge requires an interactor script in /submission/.",
      });
      return;
    }

    const interactorLang = config.interactorLanguage ?? config.checkerLanguage ?? "python";
    const interactorResult = await compileChecker(
      interactorPath,
      interactorLang,
      workDir,
      "interactor",
    );
    if (!interactorResult.success) {
      emit({
        compilationError: `Interactor compilation failed: ${interactorResult.error ?? "unknown error"}`,
      });
      return;
    }
    interactorCommand = interactorResult.runCommand;
  }

  log("Loading testcases...");
  const testcases = await loadTestcases();
  log(`Found ${String(testcases.length)} testcase(s).`);

  const results: TestcaseResult[] = [];

  for (const testcase of testcases) {
    log(`Judging testcase ${String(testcase.index)}...`);

    let result: TestcaseResult;

    switch (config.judgeType) {
      case "standard":
        result = await judgeStandard(
          compileResult.runCommand,
          testcase,
          config.limits.timeoutMs,
        );
        break;

      case "checker":
        result = await judgeChecker(
          compileResult.runCommand,
          testcase,
          checkerCommand!,
          config.limits.timeoutMs,
        );
        break;

      case "interactive":
        result = await judgeInteractive(
          compileResult.runCommand,
          testcase,
          interactorCommand!,
          config.limits.timeoutMs,
        );
        break;
    }

    results.push(result);
    log(`Testcase ${String(testcase.index)}: ${result.verdict} (${String(result.timeMs)}ms)`);
  }

  emit({ testcaseResults: results });
}

async function main(): Promise<void> {
  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.problemType}`,
  );

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  try {
    await runJudge(workDir, config);
  } finally {
    await cleanupTempDir(workDir);
  }
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
        timeMs: 0,
      },
    ],
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(1);
});
