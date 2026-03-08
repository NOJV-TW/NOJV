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

export interface JudgeSubmissionInput {
  draft: SubmissionDraft;
  memoryLimitMb?: number;
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

  const timeLimitMs = payload.timeLimitMs ?? 3_000;
  const memoryLimitMb = payload.memoryLimitMb ?? 256;
  const totalWeight = testcases.reduce((sum, testcase) => sum + testcase.weight, 0);
  let passedWeight = 0;
  let totalRuntimeMs = 0;

  for (const [index, testcase] of testcases.entries()) {
    const runResult = workspaceRunResultSchema.parse(
      await dependencies.runSolution({
        draft,
        memoryLimitMb,
        stdin: testcase.stdin,
        testcaseId: testcase.id,
        timeLimitMs,
        workspaceSessionId: `sub-${draft.problemSlug}-${testcase.id}`.slice(0, 128)
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

    if (
      normalizeProgramOutput(runResult.stdout) !==
      normalizeProgramOutput(testcase.expectedStdout)
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
