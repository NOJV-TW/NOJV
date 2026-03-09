import {
  submissionDraftSchema,
  submissionResultSchema,
  workspaceRunRequestSchema,
  workspaceRunResultSchema,
  type ProblemJudgeTestcase,
  type SubmissionDraft,
  type SubmissionResult,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";

const compileStageMarker = "__NOJV_STAGE__:compile";
const judgeableLanguages = new Set(["c", "cpp", "java", "javascript", "python", "rust"]);
const judgeInputPath = "stdin.txt";
const minimumExecutionTimeoutMs = 5_000;
const orchestrationGraceMs = 3_000;

interface JudgeLanguageSpec {
  runtimeScript: string;
  sourceFileName: string;
}

export interface ProblemTemplateInfo {
  driverCode: string;
  insertionMarker: string;
  language: string;
  templateCode: string;
}

export interface JudgeSubmissionInput {
  checkerScript?: string | null;
  draft: SubmissionDraft;
  interactorScript?: string | null;
  judgeType?: "standard" | "checker" | "interactive";
  memoryLimitMb?: number;
  submissionType?: "function" | "full_source";
  templates?: ProblemTemplateInfo[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs?: number;
}

export interface JudgeRunSolutionInput {
  draft: SubmissionDraft;
  memoryLimitMb: number;
  stdin: string;
  testcaseId: string;
  timeLimitMs: number;
  workspaceSessionId: string;
}

export interface JudgeSubmissionDependencies {
  executeRun: (request: WorkspaceRunRequest) => Promise<WorkspaceRunResult>;
  runSolution: (input: JudgeRunSolutionInput) => Promise<WorkspaceRunResult>;
}

function getLanguageSpec(language: SubmissionDraft["language"]): JudgeLanguageSpec | null {
  switch (language) {
    case "c":
      return {
        runtimeScript: [
          "if ! gcc -O2 -std=c17 -o main main.c 2>compile.stderr; then",
          "  cat compile.stderr >&2",
          `  printf '${compileStageMarker}\\n' >&2`,
          "  exit 201",
          "fi",
          `exec ./main < ${judgeInputPath}`
        ].join("\n"),
        sourceFileName: "main.c"
      };
    case "cpp":
      return {
        runtimeScript: [
          "if ! g++ -O2 -std=c++20 -o main main.cpp 2>compile.stderr; then",
          "  cat compile.stderr >&2",
          `  printf '${compileStageMarker}\\n' >&2`,
          "  exit 201",
          "fi",
          `exec ./main < ${judgeInputPath}`
        ].join("\n"),
        sourceFileName: "main.cpp"
      };
    case "java":
      return {
        runtimeScript: [
          "if ! javac Main.java 2>compile.stderr; then",
          "  cat compile.stderr >&2",
          `  printf '${compileStageMarker}\\n' >&2`,
          "  exit 201",
          "fi",
          `exec java Main < ${judgeInputPath}`
        ].join("\n"),
        sourceFileName: "Main.java"
      };
    case "javascript":
      return {
        runtimeScript: `exec node main.mjs < ${judgeInputPath}`,
        sourceFileName: "main.mjs"
      };
    case "python":
      return {
        runtimeScript: `exec python3 main.py < ${judgeInputPath}`,
        sourceFileName: "main.py"
      };
    case "rust":
      return {
        runtimeScript: [
          "if ! rustc -O -o main main.rs 2>compile.stderr; then",
          "  cat compile.stderr >&2",
          `  printf '${compileStageMarker}\\n' >&2`,
          "  exit 201",
          "fi",
          `exec ./main < ${judgeInputPath}`
        ].join("\n"),
        sourceFileName: "main.rs"
      };
    default:
      return null;
  }
}

function assembleSourceCode(
  userCode: string,
  submissionType: "function" | "full_source",
  language: string,
  templates: ProblemTemplateInfo[]
): string {
  if (submissionType === "full_source") {
    return userCode;
  }

  const template = templates.find((t) => t.language === language);
  if (!template) {
    throw new Error(
      `No template found for language "${language}" in function-mode problem.`
    );
  }

  if (!template.driverCode.includes(template.insertionMarker)) {
    throw new Error(
      `Driver code does not contain insertion marker "${template.insertionMarker}".`
    );
  }

  return template.driverCode.replace(template.insertionMarker, userCode);
}

function getCompileCommands(spec: JudgeLanguageSpec): string[] {
  const lines = spec.runtimeScript.split("\n");
  const compileLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("exec ")) {
      break;
    }
    compileLines.push(line);
  }

  // If there are no compile lines (interpreted language), return empty
  if (compileLines.length === 0 || (compileLines.length === 1 && compileLines[0] === "")) {
    return [];
  }

  return compileLines;
}

function getRunCommand(spec: JudgeLanguageSpec): string {
  const lines = spec.runtimeScript.split("\n");
  const execLine = lines.find((l) => l.startsWith("exec "));
  if (execLine) {
    return execLine.replace("exec ", "").replace(` < ${judgeInputPath}`, "");
  }
  return "";
}

function normalizeProgramOutput(output: string) {
  return output.replaceAll("\r\n", "\n").trimEnd();
}

function calculateScore(passedWeight: number, totalWeight: number) {
  if (totalWeight <= 0) {
    return 0;
  }

  return Math.floor((passedWeight / totalWeight) * 100);
}

function resolveExecutionTimeoutMs(problemTimeLimitMs: number) {
  return Math.min(
    Math.max(problemTimeLimitMs + orchestrationGraceMs, minimumExecutionTimeoutMs),
    30_000
  );
}

function buildUnsupportedLanguageResult(
  language: SubmissionDraft["language"]
): SubmissionResult {
  return submissionResultSchema.parse({
    accepted: false,
    feedback: `Language "${language}" is not enabled in the judge runtime.`,
    runtimeMs: 0,
    score: 0,
    verdict: "compile_error"
  });
}

function buildMissingTestcaseResult(): SubmissionResult {
  return submissionResultSchema.parse({
    accepted: false,
    feedback: "This problem does not have any configured testcases yet.",
    runtimeMs: 0,
    score: 0,
    verdict: "runtime_error"
  });
}

function stripCompileMarker(stderr: string) {
  return stderr.replace(`${compileStageMarker}\n`, "").replace(compileStageMarker, "").trim();
}

function testcaseLabel(testcase: ProblemJudgeTestcase, index: number) {
  return testcase.isHidden
    ? `hidden testcase ${String(index + 1)}`
    : `sample testcase ${String(index + 1)}`;
}

export function buildJudgeWorkspaceRequest(input: JudgeRunSolutionInput): WorkspaceRunRequest {
  const draft = submissionDraftSchema.parse(input.draft);
  const languageSpec = getLanguageSpec(draft.language);

  if (!languageSpec) {
    throw new Error(`Unsupported judge language: ${draft.language}`);
  }

  return workspaceRunRequestSchema.parse({
    command: "make judge",
    contestSlug: draft.contestSlug,
    files: [
      {
        content: draft.sourceCode,
        path: languageSpec.sourceFileName
      },
      {
        content: input.stdin,
        path: judgeInputPath
      },
      {
        content: `judge:\n\t@sh judge.sh\n`,
        path: "Makefile"
      },
      {
        content: `#!/bin/sh\nset -eu\n${languageSpec.runtimeScript}\n`,
        path: "judge.sh"
      }
    ],
    mode: draft.mode,
    ...(draft.assessment ? { assessment: draft.assessment } : {}),
    timeoutMs: resolveExecutionTimeoutMs(input.timeLimitMs),
    workspaceSessionId: input.workspaceSessionId
  });
}

export function buildCheckerWorkspaceRequest(input: {
  checkerScript: string;
  expectedStdout: string;
  inputFiles?: Record<string, string>;
  memoryLimitMb: number;
  stdin: string;
  testcaseId: string;
  timeLimitMs: number;
  userStdout: string;
  workspaceSessionId: string;
}): WorkspaceRunRequest {
  const files: { content: string; path: string }[] = [
    { content: input.checkerScript, path: "checker.py" },
    { content: input.stdin, path: "stdin.txt" },
    { content: input.expectedStdout, path: "expected.txt" },
    { content: input.userStdout, path: "user_output.txt" },
    {
      content: "checker:\n\t@python3 checker.py stdin.txt expected.txt user_output.txt\n",
      path: "Makefile"
    }
  ];

  if (input.inputFiles) {
    for (const [name, content] of Object.entries(input.inputFiles)) {
      files.push({ content, path: name });
    }
  }

  return workspaceRunRequestSchema.parse({
    command: "make checker",
    files,
    mode: "practice",
    timeoutMs: resolveExecutionTimeoutMs(input.timeLimitMs),
    workspaceSessionId: input.workspaceSessionId
  });
}

export function buildInteractiveWorkspaceRequest(input: {
  draft: SubmissionDraft;
  inputFiles?: Record<string, string>;
  interactorScript: string;
  memoryLimitMb: number;
  stdin: string;
  testcaseId: string;
  timeLimitMs: number;
  workspaceSessionId: string;
}): WorkspaceRunRequest {
  const languageSpec = getLanguageSpec(input.draft.language);
  if (!languageSpec) {
    throw new Error(`Unsupported language for interactive judge: ${input.draft.language}`);
  }

  const compileLines = getCompileCommands(languageSpec);
  const runCommand = getRunCommand(languageSpec);

  const compileSection =
    compileLines.length > 0 ? compileLines.join("\n") + "\n" : "";

  const interactiveScript = [
    "#!/bin/sh",
    "set -eu",
    "",
    compileSection,
    "# Set up pipes",
    "mkfifo /tmp/to_user /tmp/from_user",
    "",
    "# Run user program: reads from to_user, writes to from_user",
    `${runCommand} < /tmp/to_user > /tmp/from_user &`,
    "USER_PID=$!",
    "",
    "# Run interactor: writes to to_user (user stdin), reads from from_user (user stdout)",
    "python3 interactor.py input.txt > /tmp/to_user < /tmp/from_user",
    "INTERACTOR_EXIT=$?",
    "",
    "# Clean up",
    "wait $USER_PID 2>/dev/null || true",
    "rm -f /tmp/to_user /tmp/from_user",
    "exit $INTERACTOR_EXIT"
  ].join("\n");

  const files: { content: string; path: string }[] = [
    { content: input.draft.sourceCode, path: languageSpec.sourceFileName },
    { content: input.interactorScript, path: "interactor.py" },
    { content: input.stdin, path: "input.txt" },
    { content: interactiveScript, path: "interactive.sh" },
    { content: "interactive:\n\t@sh interactive.sh\n", path: "Makefile" }
  ];

  if (input.inputFiles) {
    for (const [name, content] of Object.entries(input.inputFiles)) {
      files.push({ content, path: name });
    }
  }

  return workspaceRunRequestSchema.parse({
    command: "make interactive",
    files,
    mode: input.draft.mode,
    ...(input.draft.assessment ? { assessment: input.draft.assessment } : {}),
    timeoutMs: resolveExecutionTimeoutMs(input.timeLimitMs),
    workspaceSessionId: input.workspaceSessionId
  });
}

function parseCheckerResult(
  runResult: WorkspaceRunResult
): { accepted: boolean; feedback: string; score: number } {
  const accepted = runResult.status === "succeeded" && runResult.exitCode === 0;
  const feedback = runResult.stderr.trim();

  // Parse score from checker stdout: integer 0-100
  const scoreText = runResult.stdout.trim();
  let score: number;
  if (scoreText.length > 0) {
    const parsed = parseInt(scoreText, 10);
    score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : (accepted ? 100 : 0);
  } else {
    score = accepted ? 100 : 0;
  }

  return { accepted, feedback, score };
}

function parseInteractiveResult(
  runResult: WorkspaceRunResult
): { accepted: boolean; feedback: string; score: number } {
  const accepted = runResult.status === "succeeded" && runResult.exitCode === 0;
  const stderrLines = runResult.stderr.trim().split("\n");

  // Line 1 of stderr: score (0-100)
  const scoreText = stderrLines[0]?.trim() ?? "";
  let score: number;
  if (scoreText.length > 0) {
    const parsed = parseInt(scoreText, 10);
    score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : (accepted ? 100 : 0);
  } else {
    score = accepted ? 100 : 0;
  }

  // Line 2+ of stderr: feedback
  const feedback = stderrLines.slice(1).join("\n").trim();

  return { accepted, feedback, score };
}

export async function judgeSubmissionAgainstTestcases(
  payload: JudgeSubmissionInput,
  dependencies: JudgeSubmissionDependencies
): Promise<SubmissionResult> {
  const draft = submissionDraftSchema.parse(payload.draft);
  const testcases = payload.testcases;
  const languageSpec = getLanguageSpec(draft.language);

  if (!languageSpec || !judgeableLanguages.has(draft.language)) {
    return buildUnsupportedLanguageResult(draft.language);
  }

  if (testcases.length === 0) {
    return buildMissingTestcaseResult();
  }

  const submissionType = payload.submissionType ?? "full_source";
  const templates = payload.templates ?? [];
  const judgeType = payload.judgeType ?? "standard";

  // Assemble source code (for function-mode, inject user code into driver template)
  let assembledSourceCode: string;
  try {
    assembledSourceCode = assembleSourceCode(
      draft.sourceCode,
      submissionType,
      draft.language,
      templates
    );
  } catch (error) {
    return submissionResultSchema.parse({
      accepted: false,
      feedback: error instanceof Error ? error.message : "Source assembly failed.",
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error"
    });
  }

  const assembledDraft = { ...draft, sourceCode: assembledSourceCode };

  const timeLimitMs = payload.timeLimitMs ?? 3_000;
  const memoryLimitMb = payload.memoryLimitMb ?? 256;
  const totalWeight = testcases.reduce((sum, testcase) => sum + testcase.weight, 0);
  let passedWeight = 0;
  let totalRuntimeMs = 0;

  for (const [index, testcase] of testcases.entries()) {
    const workspaceSessionId = `sub-${draft.problemSlug}-${testcase.id}`.slice(0, 128);

    // Interactive judge: single combined run with pipes
    if (judgeType === "interactive") {
      if (!payload.interactorScript) {
        return submissionResultSchema.parse({
          accepted: false,
          feedback: "Interactive judge requires an interactor script.",
          runtimeMs: totalRuntimeMs,
          score: 0,
          verdict: "runtime_error"
        });
      }

      const interactiveRequest = buildInteractiveWorkspaceRequest({
        draft: assembledDraft,
        ...(testcase.inputFiles ? { inputFiles: testcase.inputFiles } : {}),
        interactorScript: payload.interactorScript,
        memoryLimitMb,
        stdin: testcase.stdin,
        testcaseId: testcase.id,
        timeLimitMs,
        workspaceSessionId
      });

      const interactiveResult = workspaceRunResultSchema.parse(
        await dependencies.executeRun(interactiveRequest)
      );
      totalRuntimeMs += interactiveResult.durationMs;

      if (interactiveResult.status === "timed_out") {
        return submissionResultSchema.parse({
          accepted: false,
          feedback: `${testcaseLabel(testcase, index)} exceeded the time limit of ${String(timeLimitMs)} ms.`,
          runtimeMs: totalRuntimeMs,
          score: calculateScore(passedWeight, totalWeight),
          verdict: "time_limit_exceeded"
        });
      }

      const parsed = parseInteractiveResult(interactiveResult);
      if (!parsed.accepted) {
        return submissionResultSchema.parse({
          accepted: false,
          feedback: parsed.feedback || `${testcaseLabel(testcase, index)} was rejected by the interactor.`,
          runtimeMs: totalRuntimeMs,
          score: calculateScore(passedWeight, totalWeight),
          verdict: "wrong_answer"
        });
      }

      passedWeight += testcase.weight;
      continue;
    }

    // Standard and checker modes: run user program first
    const runResult = workspaceRunResultSchema.parse(
      await dependencies.runSolution({
        draft: assembledDraft,
        memoryLimitMb,
        stdin: testcase.stdin,
        testcaseId: testcase.id,
        timeLimitMs,
        workspaceSessionId
      })
    );
    totalRuntimeMs += runResult.durationMs;

    if (runResult.status === "timed_out") {
      return submissionResultSchema.parse({
        accepted: false,
        feedback: `${testcaseLabel(testcase, index)} exceeded the time limit of ${String(timeLimitMs)} ms.`,
        runtimeMs: totalRuntimeMs,
        score: calculateScore(passedWeight, totalWeight),
        verdict: "time_limit_exceeded"
      });
    }

    if (runResult.status !== "succeeded" || runResult.exitCode !== 0) {
      const isCompileError =
        runResult.exitCode === 201 || runResult.stderr.includes(compileStageMarker);

      return submissionResultSchema.parse({
        accepted: false,
        feedback:
          stripCompileMarker(runResult.stderr) ||
          (isCompileError
            ? "Compilation failed in the sandbox judge runtime."
            : "The submitted program exited with a runtime error."),
        runtimeMs: totalRuntimeMs,
        score: calculateScore(passedWeight, totalWeight),
        verdict: isCompileError ? "compile_error" : "runtime_error"
      });
    }

    // Checker judge: run checker script to evaluate output
    if (judgeType === "checker") {
      if (!payload.checkerScript) {
        return submissionResultSchema.parse({
          accepted: false,
          feedback: "Checker judge requires a checker script.",
          runtimeMs: totalRuntimeMs,
          score: 0,
          verdict: "runtime_error"
        });
      }

      const checkerRequest = buildCheckerWorkspaceRequest({
        checkerScript: payload.checkerScript,
        expectedStdout: testcase.expectedStdout ?? "",
        ...(testcase.inputFiles ? { inputFiles: testcase.inputFiles } : {}),
        memoryLimitMb,
        stdin: testcase.stdin,
        testcaseId: testcase.id,
        timeLimitMs,
        userStdout: runResult.stdout,
        workspaceSessionId: `checker-${workspaceSessionId}`.slice(0, 128)
      });

      const checkerResult = workspaceRunResultSchema.parse(
        await dependencies.executeRun(checkerRequest)
      );
      totalRuntimeMs += checkerResult.durationMs;

      const parsed = parseCheckerResult(checkerResult);
      if (!parsed.accepted) {
        return submissionResultSchema.parse({
          accepted: false,
          feedback: parsed.feedback || `${testcaseLabel(testcase, index)} was rejected by the checker.`,
          runtimeMs: totalRuntimeMs,
          score: calculateScore(passedWeight, totalWeight),
          verdict: "wrong_answer"
        });
      }

      passedWeight += testcase.weight;
      continue;
    }

    // Standard judge: exact output comparison
    if (
      normalizeProgramOutput(runResult.stdout) !==
      normalizeProgramOutput(testcase.expectedStdout ?? "")
    ) {
      return submissionResultSchema.parse({
        accepted: false,
        feedback: `${testcaseLabel(testcase, index)} produced unexpected output.`,
        runtimeMs: totalRuntimeMs,
        score: calculateScore(passedWeight, totalWeight),
        verdict: "wrong_answer"
      });
    }

    passedWeight += testcase.weight;
  }

  return submissionResultSchema.parse({
    accepted: true,
    feedback: `Accepted across ${String(testcases.length)} testcase(s).`,
    runtimeMs: totalRuntimeMs,
    score: 100,
    verdict: "accepted"
  });
}
