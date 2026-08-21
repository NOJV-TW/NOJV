import {
  compareStandard,
  entryFileNameFor,
  isBrowserLocalLanguage,
  type CaseResult,
  type CompareConfig,
  type JudgeType,
  type Language,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";
import {
  WASM_OJ_LIBCXX_PCH_HEADER,
  createBrowserEngine,
  type BuildResult,
  type Engine,
  type RunResult,
} from "@wasm-oj/browser";
import { browserSource as clangSource } from "@wasm-oj/toolchain-clang";
import { browserSource as goSource } from "@wasm-oj/toolchain-go";
import { browserSource as javaSource } from "@wasm-oj/toolchain-java";
import { browserSource as javascriptSource } from "@wasm-oj/toolchain-javascript";
import { browserSource as pythonSource } from "@wasm-oj/toolchain-python";
import { browserSource as rustSource } from "@wasm-oj/toolchain-rust";
import { formatJudgeOutput } from "$lib/utils/judge-output";
import type { SubmissionRequest } from "./submission-service";

const BROWSER_TOOLCHAIN_BASE_URL = "/wasm-oj/toolchains/";
let browserEnginePromise: Promise<Engine> | undefined;

export function supportsBrowserLocalRun(language: Language): boolean {
  return isBrowserLocalLanguage(language);
}

export function shouldUseBrowserLocalRun(args: {
  sampleOnly: boolean;
  specialEnv: boolean;
  judgeType: JudgeType;
  language: Language;
}): boolean {
  return (
    args.sampleOnly &&
    !args.specialEnv &&
    args.judgeType === "standard" &&
    supportsBrowserLocalRun(args.language)
  );
}

async function getBrowserEngine(): Promise<Engine> {
  browserEnginePromise ??= createBrowserEngine({
    artifactCache: true,
    toolchains: [
      clangSource(BROWSER_TOOLCHAIN_BASE_URL),
      goSource(BROWSER_TOOLCHAIN_BASE_URL),
      javaSource(BROWSER_TOOLCHAIN_BASE_URL),
      javascriptSource(BROWSER_TOOLCHAIN_BASE_URL),
      pythonSource(BROWSER_TOOLCHAIN_BASE_URL),
      rustSource(BROWSER_TOOLCHAIN_BASE_URL),
    ],
  }).catch((error: unknown) => {
    browserEnginePromise = undefined;
    throw error;
  });
  return browserEnginePromise;
}

export async function prewarmBrowserLocalEngine(): Promise<void> {
  await getBrowserEngine();
}

export function browserLocalFiles(request: SubmissionRequest): {
  entry: string;
  files: Record<string, string>;
} {
  const entry = entryFileNameFor(request.language);
  const files =
    request.sourceFiles && request.sourceFiles.length > 0
      ? Object.fromEntries(request.sourceFiles.map((file) => [file.path, file.content]))
      : { [entry]: request.sourceCode };
  if (
    request.language === "cpp" &&
    Object.values(files).some((content) => content.includes("#include <bits/stdc++.h>"))
  ) {
    for (const [path, content] of Object.entries(files)) {
      files[path] = content.replaceAll("#include <bits/stdc++.h>", '#include "bits/stdc++.h"');
    }
    files["bits/stdc++.h"] ??= WASM_OJ_LIBCXX_PCH_HEADER;
  }
  return { entry, files };
}

export function browserLocalStdin(language: Language, input: string): string {
  return language === "python" && input.length > 0 && !input.endsWith("\n")
    ? `${input}\n`
    : input;
}

export function browserLocalTerminationVerdict(
  termination: RunResult["termination"],
  exitCode: number,
): CaseResult["verdict"] {
  if (
    termination === "instruction-limit" ||
    termination === "logical-time-limit" ||
    termination === "wall-time-limit"
  ) {
    return "TLE";
  }
  if (termination === "memory-limit") return "MLE";
  if (termination === "exited" && exitCode === 0) return "AC";
  return "RE";
}

export function browserLocalTerminationFeedback(
  termination: RunResult["termination"],
  exitCode: number,
  trapMessage?: string,
): string | undefined {
  switch (termination) {
    case "instruction-limit":
    case "logical-time-limit":
    case "wall-time-limit":
      return "Time limit exceeded.";
    case "memory-limit":
      return "Memory limit exceeded.";
    case "output-limit":
      return "Output limit exceeded.";
    case "filesystem-limit":
      return "Filesystem limit exceeded.";
    case "trap":
      return trapMessage?.length ? trapMessage : "Runtime trap.";
    case "exited":
      return exitCode === 0 ? undefined : `Process exited with code ${String(exitCode)}.`;
  }
}

export function mapBrowserLocalRunResult(
  run: RunResult,
  expectedOutput: string | undefined,
  compare: CompareConfig | null | undefined,
  index: number,
): CaseResult {
  let verdict = browserLocalTerminationVerdict(run.termination, run.code);
  if (verdict === "AC" && expectedOutput !== undefined) {
    verdict = compareStandard(run.stdout, expectedOutput, compare ?? {}) ? "AC" : "WA";
  }
  const diagnostic =
    run.stderr.length > 0
      ? run.stderr
      : browserLocalTerminationFeedback(run.termination, run.code, run.trapMessage);
  return {
    index,
    verdict,
    timeMs: Math.max(0, Math.round(run.durationMs)),
    ...(run.metrics.memoryBytes != null
      ? { memoryKb: Math.max(0, Math.ceil(run.metrics.memoryBytes / 1024)) }
      : {}),
    stdout: run.stdout.slice(0, 1_000_000),
    ...(diagnostic ? { stderr: formatJudgeOutput(diagnostic).slice(0, 100_000) } : {}),
  };
}

function submissionVerdict(caseResults: CaseResult[]): SubmissionResult["verdict"] {
  const first = caseResults.find((result) => result.verdict !== "AC")?.verdict;
  switch (first) {
    case "WA":
      return "wrong_answer";
    case "TLE":
      return "time_limit_exceeded";
    case "MLE":
      return "memory_limit_exceeded";
    case "RE":
      return "runtime_error";
    default:
      return "accepted";
  }
}

function compileFeedback(build: BuildResult): string {
  const diagnostics = build.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map(
      (diagnostic) =>
        `${diagnostic.file}:${String(diagnostic.line)}:${String(diagnostic.column)}: ${diagnostic.message}`,
    )
    .join("\n");
  return formatJudgeOutput(
    build.stderr || build.stdout || diagnostics || "Compilation failed.",
  ).slice(0, 10_000);
}

export function browserLocalErrorResult(error: unknown): SubmissionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    accepted: false,
    caseResults: [],
    feedback: formatJudgeOutput(`Browser local compilation failed.\n${message}`).slice(
      0,
      10_000,
    ),
    runtimeMs: 0,
    score: 0,
    verdict: "compile_error",
  };
}

export async function runBrowserLocally(args: {
  request: SubmissionRequest;
  cases: SubmissionRunCase[];
  compare: CompareConfig | null | undefined;
  problemId: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  signal: AbortSignal;
}): Promise<SubmissionResult | null> {
  const browserEngine = await getBrowserEngine();
  const cancel = () => browserEngine.cancel();
  args.signal.addEventListener("abort", cancel, { once: true });

  try {
    if (args.signal.aborted) return null;
    const { entry, files } = browserLocalFiles(args.request);
    const build = await browserEngine.compile(
      {
        language: args.request.language,
        target: "wasip1",
        optimization: "release",
        entry,
        files,
        name: `NOJV local ${args.problemId}`,
        projectId: `nojv-local-browser-v1-${args.problemId}-${args.request.language}`,
      },
      { cache: true },
    );
    if (!build.success || !build.artifact) {
      return {
        accepted: false,
        caseResults: [],
        feedback: compileFeedback(build),
        runtimeMs: 0,
        score: 0,
        verdict: "compile_error",
      };
    }

    const caseResults: CaseResult[] = [];
    for (const [index, testCase] of args.cases.entries()) {
      const run = await browserEngine.run(build.artifact, {
        stdin: browserLocalStdin(args.request.language, testCase.input),
        resources: {
          logicalTimeLimitMs: args.timeLimitMs,
          memoryLimitBytes: args.memoryLimitMb * 1024 * 1024,
          outputLimitBytes: 1_000_000,
          filesystemWriteLimitBytes: 64 * 1024 * 1024,
          filesystemEntryLimit: 4096,
          wallTimeLimitMs: Math.min(600_000, Math.max(1_000, args.timeLimitMs * 3)),
        },
      });
      caseResults.push(
        mapBrowserLocalRunResult(run, testCase.expectedOutput, args.compare, index),
      );
    }

    const runtimeMs = caseResults.reduce((max, result) => Math.max(max, result.timeMs), 0);
    const accepted = caseResults.every((result) => result.verdict === "AC");
    return {
      accepted,
      caseResults,
      feedback: accepted ? "Local browser run completed." : "One or more test cases failed.",
      runtimeMs,
      memoryKb: caseResults.reduce((max, result) => Math.max(max, result.memoryKb ?? 0), 0),
      score: accepted ? 100 : 0,
      verdict: submissionVerdict(caseResults),
    };
  } catch (error) {
    if (args.signal.aborted) return null;
    return browserLocalErrorResult(error);
  } finally {
    args.signal.removeEventListener("abort", cancel);
  }
}
