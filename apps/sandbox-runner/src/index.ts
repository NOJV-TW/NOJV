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
import { pathExists } from "./utils.js";
import { judgeStandard } from "./judges/standard.js";
import { judgeChecker } from "./judges/checker.js";
import { judgeInteractive } from "./judges/interactive.js";
import { runAdvancedMode } from "./advanced-mode.js";
import { runStaticAnalysis } from "./stages/static-analysis.js";
import { runCustomScoring, type ScoringInput } from "./stages/score.js";
import { collectArtifacts } from "./stages/artifact.js";
import { runCustomScriptStage, type CustomScriptContext } from "./stages/custom-script.js";
import {
  normalizeRelativePath,
  type StaticAnalysisResult,
  type ArtifactEntry,
  type CustomScriptRunAt,
  type CustomScriptStage,
  type CustomScriptStageResult
} from "@nojv/core";

const SUBMISSION_DIR = "/submission";
const ARTIFACT_DIR = "/workspace/artifacts";

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
  entryFile?: string
): Promise<string> {
  const fileCandidates = [entryFile, sourceFileName(language)].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
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
  content: string
): Promise<void> {
  const fullPath = path.join(workDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function materializeConfiguredSources(
  config: SandboxInput,
  workDir: string
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

function pipelineCustomStages(
  config: SandboxInput,
  runAt: CustomScriptRunAt
): CustomScriptStage[] {
  return (config.pipeline?.stages ?? []).filter(
    (stage): stage is CustomScriptStage =>
      stage.type === "custom-script" && stage.config.runAt === runAt
  );
}

/** State carried through the main pipeline that feeds every emitted output. */
interface PipelineState {
  staticAnalysisResult?: StaticAnalysisResult;
  customStageResults: CustomScriptStageResult[];
}

/** Write a SandboxOutput to stdout, merging the accumulated pipeline state. */
function emit(state: PipelineState, overrides: Partial<SandboxOutput>): void {
  const output: SandboxOutput = {
    testcaseResults: [],
    ...(state.staticAnalysisResult ? { staticAnalysis: state.staticAnalysisResult } : {}),
    ...(state.customStageResults.length > 0
      ? { customStageResults: state.customStageResults }
      : {}),
    ...overrides
  };
  process.stdout.write(JSON.stringify(output));
}

async function runCustomStagesAtHook(
  config: SandboxInput,
  runAt: CustomScriptRunAt,
  context: CustomScriptContext,
  results: CustomScriptStageResult[]
): Promise<string | undefined> {
  const stages = pipelineCustomStages(config, runAt);
  for (const stage of stages) {
    log(`Running custom stage '${stage.name}' (${runAt})...`);
    const stageResult = await runCustomScriptStage(stage, runAt, context);
    results.push(stageResult);
    if (!stageResult.passed && !stage.continueOnFail) {
      const reason = stageResult.feedback ?? `exitCode=${String(stageResult.exitCode)}`;
      return `Pipeline stage '${stage.name}' failed: ${reason}`;
    }
  }

  return undefined;
}

async function main(): Promise<void> {
  // 1. Read config
  log("Reading config...");
  const config = await readConfig();
  log(
    `Submission ${config.submissionId}: ${config.language} / ${config.judgeType} / ${config.submissionType}`
  );

  // 1a. Phase 7: advanced mode (TA-provided judge container) — runs an
  // entirely separate code path and bypasses the standard pipeline.
  if (config.advanced) {
    log("Dispatching to advanced-mode runner...");
    const advancedResult = await runAdvancedMode(config);
    process.stdout.write(JSON.stringify(advancedResult));
    return;
  }

  // 2. Prepare source files in a work directory
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-"));
  await materializeConfiguredSources(config, workDir);
  const state: PipelineState = { customStageResults: [] };

  const defaultEntry = sourceFileName(config.language);
  const entryFile =
    (config.entryFile && normalizeRelativePath(config.entryFile)) ?? defaultEntry;
  const srcFile = path.join(workDir, entryFile);

  if (config.submissionType === "function") {
    // Function mode always assembles user code into the entry file using the template.
    log("Reading source code...");

    let rawSource: string;
    if (await pathExists(srcFile)) {
      rawSource = await fs.readFile(srcFile, "utf-8");
    } else {
      rawSource = await readSourceCode(config.language, entryFile);
    }

    let assembledSource: string;
    try {
      assembledSource = assembleSource(rawSource, config);
    } catch (err) {
      emit(state, {
        compilationError: err instanceof Error ? err.message : "Source assembly failed."
      });
      return;
    }

    await writeWorkFile(workDir, entryFile, assembledSource);
  } else if (!(await pathExists(srcFile))) {
    // Full-source mode can run from uploaded project files; fallback to the canonical source file.
    log("Reading source code...");
    const rawSource = await readSourceCode(config.language, entryFile);
    await writeWorkFile(workDir, entryFile, rawSource);
  }

  // ─── Pipeline Stage: Static Analysis ───────────────────────────
  if (config.staticAnalysis) {
    log("Running static analysis...");
    state.staticAnalysisResult = await runStaticAnalysis(srcFile, config.staticAnalysis);
    log(
      `Static analysis: ${state.staticAnalysisResult.passed ? "PASSED" : "FAILED"} (${String(state.staticAnalysisResult.violations.length)} violations)`
    );

    if (!state.staticAnalysisResult.passed) {
      const saStage = config.pipeline?.stages.find((s) => s.type === "static-analysis");
      const continueOnFail = saStage ? saStage.continueOnFail : false;

      if (!continueOnFail) {
        const violationMessages = state.staticAnalysisResult.violations
          .filter((v) => v.severity === "error")
          .map((v) => `Line ${String(v.line ?? "?")}: ${v.message}`)
          .join("\n");
        emit(state, { compilationError: `Static analysis failed:\n${violationMessages}` });
        return;
      }
    }
  }

  const beforeCompileError = await runCustomStagesAtHook(
    config,
    "before-compile",
    {
      submissionId: config.submissionId,
      language: config.language,
      judgeType: config.judgeType,
      workDir,
      sourcePath: srcFile
    },
    state.customStageResults
  );

  if (beforeCompileError) {
    emit(state, { pipelineError: beforeCompileError });
    return;
  }

  // ─── Pipeline Stage: Compile ───────────────────────────────────
  log("Compiling...");
  const compileResult = await compile(config, srcFile, workDir);

  if (!compileResult.success) {
    emit(state, { compilationError: compileResult.error });
    return;
  }

  // 5. If checker/interactive: compile checker/interactor
  let checkerCommand: string[] | undefined;
  let interactorCommand: string[] | undefined;

  if (config.judgeType === "checker") {
    const checkerPath = await findScript("checker");
    if (!checkerPath) {
      emit(state, {
        compilationError: "Checker judge requires a checker script in /submission/."
      });
      return;
    }

    const checkerLang = config.checkerLanguage ?? "python";
    const checkerResult = await compileChecker(checkerPath, checkerLang, workDir, "checker");
    if (!checkerResult.success) {
      emit(state, {
        compilationError: `Checker compilation failed: ${checkerResult.error ?? "unknown error"}`
      });
      return;
    }
    checkerCommand = checkerResult.runCommand;
  }

  if (config.judgeType === "interactive") {
    const interactorPath = await findScript("interactor");
    if (!interactorPath) {
      emit(state, {
        compilationError: "Interactive judge requires an interactor script in /submission/."
      });
      return;
    }

    const interactorLang = config.interactorLanguage ?? config.checkerLanguage ?? "python";
    const interactorResult = await compileChecker(
      interactorPath,
      interactorLang,
      workDir,
      "interactor"
    );
    if (!interactorResult.success) {
      emit(state, {
        compilationError: `Interactor compilation failed: ${interactorResult.error ?? "unknown error"}`
      });
      return;
    }
    interactorCommand = interactorResult.runCommand;
  }

  const afterCompileError = await runCustomStagesAtHook(
    config,
    "after-compile",
    {
      submissionId: config.submissionId,
      language: config.language,
      judgeType: config.judgeType,
      workDir,
      sourcePath: srcFile
    },
    state.customStageResults
  );

  if (afterCompileError) {
    emit(state, { pipelineError: afterCompileError });
    return;
  }

  // ─── Pipeline Stage: Execute + Check ───────────────────────────
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

  const afterCheckError = await runCustomStagesAtHook(
    config,
    "after-check",
    {
      submissionId: config.submissionId,
      language: config.language,
      judgeType: config.judgeType,
      workDir,
      sourcePath: srcFile,
      rawScore: computeRawScore(results),
      testcaseResults: results
    },
    state.customStageResults
  );

  if (afterCheckError) {
    emit(state, { pipelineError: afterCheckError, testcaseResults: results });
    return;
  }

  // ─── Pipeline Stage: Artifact Collection ───────────────────────
  let artifacts: ArtifactEntry[] | undefined;

  if (config.artifactCollection) {
    log("Collecting artifacts...");
    try {
      artifacts = await collectArtifacts(workDir, ARTIFACT_DIR, config.artifactCollection);
      log(`Collected ${String(artifacts.length)} artifact(s).`);
    } catch (err) {
      log(`Artifact collection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Pipeline Stage: Custom Scoring ────────────────────────────
  let customScore: number | undefined;
  let scoringFeedback: string | undefined;

  if (config.scoring) {
    log("Running custom scoring...");
    const rawScore = computeRawScore(results);
    const scoringInput: ScoringInput = {
      submissionId: config.submissionId,
      language: config.language,
      rawScore,
      testcaseResults: results,
      submittedAt: new Date().toISOString()
    };

    try {
      const scoringOutput = await runCustomScoring(config.scoring, scoringInput);
      customScore = scoringOutput.finalScore;
      scoringFeedback = scoringOutput.feedback;
      log(`Custom scoring: ${String(customScore)} (raw: ${String(rawScore)})`);
    } catch (err) {
      log(`Custom scoring failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  emit(state, {
    testcaseResults: results,
    ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
    ...(customScore !== undefined ? { customScore } : {}),
    ...(scoringFeedback ? { scoringFeedback } : {})
  });
}

/**
 * Compute an unweighted raw score from testcase results (percentage of AC).
 * NOTE: This is an approximation for use by custom scoring scripts. The
 * authoritative weighted score is computed by submission-runner.ts using
 * per-subtask weights. Do not use this value for final grading.
 */
function computeRawScore(results: TestcaseResult[]): number {
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.verdict === "AC").length;
  return Math.round((passed / results.length) * 100);
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
