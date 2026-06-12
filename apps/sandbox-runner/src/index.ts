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
  type ValidateOutput,
  type ValidatorCaseOutcome,
} from "./types.js";
import { compile, compileInteractor, compileValidator, sourceFileName } from "./compiler.js";
import { cleanupTempDir, pathExists } from "./utils.js";
import { runSolution } from "./judges/standard.js";
import {
  resolveInteractiveCaseFiles,
  runInteractiveSolution,
  runInteractiveValidator,
} from "./judges/interactive-isolated.js";
import {
  resolveValidateCaseFiles,
  validateCase,
  validatorTimeoutMs,
} from "./judges/validate.js";
import { normalizeRelativePath, type RawCaseRun } from "@nojv/core";

const SUBMISSION_DIR = "/submission";
const DEFAULT_TESTCASE_META = { weight: 1, isSample: false } as const;

function log(message: string): void {
  process.stderr.write(`[sandbox-runner] ${message}\n`);
}

async function readConfig(): Promise<SandboxInput> {
  const raw = await fs.readFile(path.join(SUBMISSION_DIR, "config.json"), "utf-8");
  return SandboxInputSchema.parse(JSON.parse(raw));
}

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
      continue;
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
      continue;
    }
  }
}

async function loadTestcases(): Promise<TestcaseFiles[]> {
  const testcasesDir = path.join(SUBMISSION_DIR, "testcases");

  try {
    const entries = await fs.readdir(testcasesDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

    if (dirs.length > 0) {
      return await loadTestcasesFromDirs(testcasesDir, dirs);
    }
  } catch {
    return loadTestcasesFromFlatKeys();
  }

  return loadTestcasesFromFlatKeys();
}

async function loadTestcasesFromDirs(
  testcasesDir: string,
  dirs: string[],
): Promise<TestcaseFiles[]> {
  const testcases: TestcaseFiles[] = [];

  for (const dirName of dirs) {
    const tcDir = path.join(testcasesDir, dirName);
    const index = Number.parseInt(dirName, 10);

    const input = await fs.readFile(path.join(tcDir, "input.txt"), "utf-8");

    let expected: string | undefined;
    try {
      expected = await fs.readFile(path.join(tcDir, "expected.txt"), "utf-8");
    } catch {
      expected = undefined;
    }

    let meta: TestcaseMeta = {};
    try {
      const metaRaw = await fs.readFile(path.join(tcDir, "meta.json"), "utf-8");
      const parsed = TestcaseMetaSchema.safeParse(JSON.parse(metaRaw));
      if (parsed.success) meta = parsed.data;
    } catch {
      meta = {};
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

async function loadTestcasesFromFlatKeys(): Promise<TestcaseFiles[]> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const inputFiles = entries
    .filter((e) => /^testcase-\d+-input\.txt$/.test(e))
    .sort((a, b) => {
      const ai = Number.parseInt(a.split("-")[1] ?? "", 10);
      const bi = Number.parseInt(b.split("-")[1] ?? "", 10);
      return ai - bi;
    });

  const testcases: TestcaseFiles[] = [];

  for (const inputFile of inputFiles) {
    const index = Number.parseInt(inputFile.split("-")[1] ?? "", 10);
    const input = await fs.readFile(path.join(SUBMISSION_DIR, inputFile), "utf-8");

    let expected: string | undefined;
    try {
      expected = await fs.readFile(
        path.join(SUBMISSION_DIR, `testcase-${String(index)}-expected.txt`),
        "utf-8",
      );
    } catch {
      expected = undefined;
    }

    testcases.push({ index, input, expected, ...DEFAULT_TESTCASE_META });
  }

  return testcases;
}

async function findScript(prefix: string): Promise<string | null> {
  const entries = await fs.readdir(SUBMISSION_DIR);
  const match = entries.find((e) => e.startsWith(`${prefix}.`));
  return match ? path.join(SUBMISSION_DIR, match) : null;
}

function emit(overrides: Partial<SandboxOutput>): void {
  const output: SandboxOutput = {
    testcaseResults: [],
    ...overrides,
  };
  process.stdout.write(JSON.stringify(output));
}

function emitValidate(output: ValidateOutput): void {
  process.stdout.write(JSON.stringify(output));
}

async function runValidate(workDir: string, config: SandboxInput): Promise<void> {
  const validate = config.validate;
  if (!validate) {
    emitValidate({ compilationError: "Validate phase invoked without a validate block." });
    return;
  }

  const validatorPath = await findScript("validator");
  if (!validatorPath) {
    emitValidate({ compilationError: "Validate phase requires a validator script." });
    return;
  }

  log("Compiling validator...");
  const compiled = await compileValidator(validatorPath, validate.language, workDir);
  if (!compiled.success) {
    emitValidate({ compilationError: `Validator compilation failed: ${compiled.error}` });
    return;
  }

  const timeoutMs = validatorTimeoutMs(config.limits.timeoutMs);
  const validatorOutcomes: ValidatorCaseOutcome[] = [];

  for (const { index } of validate.cases) {
    const files = await resolveValidateCaseFiles(SUBMISSION_DIR, index);

    const feedbackDir = await fs.mkdtemp(path.join(workDir, `fb-${String(index)}-`));
    log(`Validating case ${String(index)}...`);
    const outcome = await validateCase(
      compiled.runCommand,
      files,
      feedbackDir,
      index,
      timeoutMs,
    );
    validatorOutcomes.push(outcome);
    log(`Case ${String(index)}: ${outcome.verdict}`);
  }

  emitValidate({ validatorOutcomes });
}

async function compileSubmission(
  workDir: string,
  config: SandboxInput,
): Promise<ReturnType<typeof compile>> {
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
  return compile(config, srcFile, workDir);
}

async function runInteractive(workDir: string, config: SandboxInput): Promise<void> {
  const { interactive } = config;
  if (!interactive) throw new Error("runInteractive called without an interactive config.");

  if (interactive.role === "solution") {
    const compileResult = await compileSubmission(workDir, config);
    if (!compileResult.success) {
      emit({ compilationError: compileResult.error });
      return;
    }
    await runInteractiveSolution(
      compileResult.runCommand,
      config.limits.timeoutMs,
      config.limits.env,
    );
    return;
  }

  const interactorPath = await findScript("interactor");
  if (!interactorPath) {
    emit({ compilationError: "Interactive validator requires an interactor script." });
    return;
  }

  const interactorLang = interactive.language ?? config.interactorLanguage ?? "python";
  log("Compiling interactor...");
  const compiled = await compileInteractor(interactorPath, interactorLang, workDir);
  if (!compiled.success) {
    emit({ compilationError: `Interactor compilation failed: ${compiled.error}` });
    return;
  }

  const index = interactive.index ?? 0;
  const { inputFile, answerFile } = await resolveInteractiveCaseFiles(SUBMISSION_DIR, index);
  const feedbackDir = await fs.mkdtemp(path.join(workDir, "fb-"));

  log(`Running interactor for case ${String(index)}...`);
  await runInteractiveValidator(
    compiled.runCommand,
    { inputFile, answerFile, feedbackDir },
    validatorTimeoutMs(config.limits.timeoutMs),
  );
}

async function runJudge(workDir: string, config: SandboxInput): Promise<void> {
  const compileResult = await compileSubmission(workDir, config);

  if (!compileResult.success) {
    emit({ compilationError: compileResult.error });
    return;
  }

  log("Loading testcases...");
  const testcases = await loadTestcases();
  log(`Found ${String(testcases.length)} testcase(s).`);

  const rawRuns: RawCaseRun[] = [];
  for (const testcase of testcases) {
    log(`Running testcase ${String(testcase.index)}...`);
    const run = await runSolution(
      compileResult.runCommand,
      testcase,
      config.limits.timeoutMs,
      config.limits.env,
    );
    rawRuns.push(run);
    log(
      `Testcase ${String(testcase.index)}: ${run.errorVerdict ?? "ran"} (${String(run.timeMs)}ms)`,
    );
  }
  emit({ rawRuns });
}

async function main(): Promise<void> {
  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.problemType}`,
  );

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  try {
    if (config.interactive) {
      await runInteractive(workDir, config);
    } else if (config.validate) {
      await runValidate(workDir, config);
    } else {
      await runJudge(workDir, config);
    }
  } finally {
    await cleanupTempDir(workDir);
  }
}

try {
  await main();
} catch (err) {
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
}
