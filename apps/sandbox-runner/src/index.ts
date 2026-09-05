import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  SandboxInputSchema,
  type SandboxInput,
  type SandboxOutput,
  type ValidateOutput,
  type ValidatorCaseOutcome,
} from "./types.js";
import { compile, compileInteractor, compileValidator, sourceFileName } from "./compiler.js";
import { readTestcase } from "./testcase-files.js";
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
import { normalizeRelativePath } from "@nojv/core";
import { materializePayload } from "./payload-materializer.js";

const SUBMISSION_DIR = "/submission";
const ARTIFACT_DIR = "/artifact";
const RUN_COMMAND_FILE = path.join(ARTIFACT_DIR, "run-command.json");

function log(message: string): void {
  process.stderr.write(`[sandbox-runner] ${message}\n`);
}

async function readConfig(): Promise<SandboxInput> {
  const raw = await fs.readFile(path.join(SUBMISSION_DIR, "config.json"), "utf-8");
  return SandboxInputSchema.parse(JSON.parse(raw));
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
    await writeWorkFile(workDir, normalizedPath, sourceFile.content);
  }

  for (const fileRef of config.sourceFileMap ?? []) {
    const normalizedPath = normalizeRelativePath(fileRef.path);
    const normalizedKey = normalizeRelativePath(fileRef.key);
    const content = await fs.readFile(path.join(SUBMISSION_DIR, normalizedKey), "utf-8");
    await writeWorkFile(workDir, normalizedPath, content);
  }
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
  const entryFile = config.entryFile ? normalizeRelativePath(config.entryFile) : defaultEntry;
  const srcFile = path.join(workDir, entryFile);

  if (!(await pathExists(srcFile))) {
    log("Reading source code...");
    const rawSource = await fs.readFile(path.join(SUBMISSION_DIR, entryFile), "utf-8");
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

  const interactorLang = interactive.language;
  log("Compiling interactor...");
  const compiled = await compileInteractor(interactorPath, interactorLang, workDir);
  if (!compiled.success) {
    emit({ compilationError: `Interactor compilation failed: ${compiled.error}` });
    return;
  }

  const index = interactive.index;
  const { inputFile, answerFile } = resolveInteractiveCaseFiles(SUBMISSION_DIR, index);
  const feedbackDir = await fs.mkdtemp(path.join(workDir, "fb-"));

  log(`Running interactor for case ${String(index)}...`);
  await runInteractiveValidator(
    compiled.runCommand,
    { inputFile, answerFile, feedbackDir },
    validatorTimeoutMs(config.limits.timeoutMs),
  );
}

async function runCompilePhase(config: SandboxInput): Promise<void> {
  const compileResult = await compileSubmission(ARTIFACT_DIR, config);
  if (!compileResult.success) {
    process.stdout.write(JSON.stringify({ compilationError: compileResult.error }));
    return;
  }
  await fs.writeFile(RUN_COMMAND_FILE, JSON.stringify(compileResult.runCommand), "utf-8");
  process.stdout.write(JSON.stringify({ runCommand: compileResult.runCommand }));
}

async function runPreparePhase(): Promise<void> {
  await materializePayload({ payloadDir: "/payload", submissionDir: SUBMISSION_DIR });
  await runCompilePhase(await readConfig());
}

async function resolveRunCommand(config: SandboxInput): Promise<string[] | null> {
  if (config.mode?.kind === "run-case") return config.mode.runCommand;
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(RUN_COMMAND_FILE, "utf-8"));
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((s): s is string => typeof s === "string")
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

async function runSingleCase(config: SandboxInput, caseIndex: number): Promise<void> {
  const runCommand = await resolveRunCommand(config);
  if (!runCommand) {
    emit({
      pipelineError:
        "run-case phase could not resolve a run command (missing run-command.json).",
    });
    return;
  }

  const testcase = await readTestcase(SUBMISSION_DIR, caseIndex);

  const run = await runSolution(
    runCommand,
    testcase,
    config.limits.timeoutMs,
    config.limits.env,
    true,
  );
  emit({ rawRuns: [run] });
}

function resolveCaseIndex(config: SandboxInput): number | null {
  const fromEnv = process.env.SANDBOX_CASE_INDEX;
  if (fromEnv !== undefined) {
    const parsed = Number(fromEnv);
    return fromEnv.trim() && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return config.mode?.kind === "run-case" ? config.mode.caseIndex : null;
}

async function main(): Promise<void> {
  if (process.env.SANDBOX_PHASE === "prepare") {
    await runPreparePhase();
    return;
  }
  if (process.env.SANDBOX_PHASE === "materialize") {
    await materializePayload({ payloadDir: "/payload", submissionDir: SUBMISSION_DIR });
    return;
  }

  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.problemType}`,
  );

  const phase = process.env.SANDBOX_PHASE ?? config.mode?.kind;

  if (phase === "compile") {
    await runCompilePhase(config);
    return;
  }
  if (phase === "run-case") {
    const caseIndex = resolveCaseIndex(config);
    if (caseIndex === null) {
      emit({ pipelineError: "run-case phase requires a valid case index." });
      return;
    }
    await runSingleCase(config, caseIndex);
    return;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  try {
    if (config.interactive) {
      await runInteractive(workDir, config);
    } else if (config.validate) {
      await runValidate(workDir, config);
    } else {
      emit({
        pipelineError:
          "no phase specified (expected compile, run-case, interactive, or validate).",
      });
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
