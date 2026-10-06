import {
  MAX_EXECUTION_OUTPUT_BYTES,
  compareStandard,
  entryFileNameFor,
  effectiveTimeLimitMs,
  isBrowserLocalLanguage,
  wasmOjTerminationVerdict,
  withCppPlatformHeaders,
  type CaseResult,
  type CompareConfig,
  type JudgeType,
  type JudgeConfig,
  type Language,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";
import {
  WASM_OJ_LIBCXX_PCH_HEADER,
  createBrowserEngine,
  prefetchBrowserToolchain,
  type BrowserToolchainPrefetchProgress,
  type BuildArtifact,
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
import { m } from "$lib/paraglide/messages.js";
import { formatJudgeOutput } from "$lib/utils/judge-output";
import type { SubmissionRequest } from "./submission-service";

const BROWSER_TOOLCHAIN_BASE_URL = "/wasm-oj/toolchains/";
const BROWSER_TOOLCHAINS = [
  clangSource(BROWSER_TOOLCHAIN_BASE_URL),
  goSource(BROWSER_TOOLCHAIN_BASE_URL),
  javaSource(BROWSER_TOOLCHAIN_BASE_URL),
  javascriptSource(BROWSER_TOOLCHAIN_BASE_URL),
  pythonSource(BROWSER_TOOLCHAIN_BASE_URL),
  rustSource(BROWSER_TOOLCHAIN_BASE_URL),
];
const TOOLCHAIN_PRELOAD_RETRY_DELAYS_MS = [2_000, 5_000];
let browserEnginePromise: Promise<Engine> | undefined;

interface ToolchainPreload {
  promise: Promise<void>;
  progress: BrowserToolchainPrefetchProgress;
  listeners: Set<(progress: BrowserToolchainPrefetchProgress) => void>;
  settled: boolean;
}

const toolchainPreloads = new Map<Language, ToolchainPreload>();

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
    toolchains: BROWSER_TOOLCHAINS,
  }).catch((error: unknown) => {
    browserEnginePromise = undefined;
    throw error;
  });
  return browserEnginePromise;
}

export async function prewarmBrowserLocalEngine(): Promise<void> {
  await getBrowserEngine();
}

export function browserToolchainPercent(progress: BrowserToolchainPrefetchProgress): number {
  if (progress.totalBytes === 0) return 0;
  return Math.min(100, Math.floor((progress.loadedBytes / progress.totalBytes) * 100));
}

export function preloadBrowserToolchain(
  language: Language,
  onProgress?: (progress: BrowserToolchainPrefetchProgress) => void,
): Promise<void> {
  const existing = toolchainPreloads.get(language);
  if (existing) {
    if (onProgress && !existing.settled) {
      existing.listeners.add(onProgress);
      onProgress(existing.progress);
    }
    return existing.promise;
  }
  const preload: ToolchainPreload = {
    promise: Promise.resolve(),
    progress: { loadedBytes: 0, totalBytes: 0 },
    listeners: new Set(onProgress ? [onProgress] : []),
    settled: false,
  };
  toolchainPreloads.set(language, preload);
  preload.promise = prefetchWithRetries(language, (progress) => {
    preload.progress = progress;
    for (const listener of preload.listeners) listener(progress);
  })
    .catch((error: unknown) => {
      toolchainPreloads.delete(language);
      throw error;
    })
    .finally(() => {
      preload.settled = true;
      preload.listeners.clear();
    });
  return preload.promise;
}

async function prefetchWithRetries(
  language: Language,
  onProgress: (progress: BrowserToolchainPrefetchProgress) => void,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await prefetchBrowserToolchain(BROWSER_TOOLCHAINS, {
        language,
        libcxxPrecompiledHeader: language === "cpp",
        onProgress,
      });
      return;
    } catch (error) {
      const delay = TOOLCHAIN_PRELOAD_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
  if (request.language === "cpp") {
    return { entry, files: withCppPlatformHeaders(files, WASM_OJ_LIBCXX_PCH_HEADER) };
  }
  return { entry, files };
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

export interface BrowserCaseRun {
  verdict: ReturnType<typeof wasmOjTerminationVerdict>;
  stdout: string;
  stderr?: string;
  timeMs: number;
  memoryKb?: number;
  exitCode: number;
  termination: RunResult["termination"];
}

export interface BrowserRunLimits {
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
  env: Record<string, string>;
}

export type BrowserCompileOutcome =
  { ok: true; artifact: BuildArtifact } | { ok: false; result: SubmissionResult };

function browserCaseRun(run: RunResult): BrowserCaseRun {
  const diagnostic =
    run.stderr.length > 0
      ? run.stderr
      : browserLocalTerminationFeedback(run.termination, run.code, run.trapMessage);
  return {
    verdict: wasmOjTerminationVerdict(run.termination, run.code),
    stdout: run.stdout,
    ...(diagnostic ? { stderr: formatJudgeOutput(diagnostic).slice(0, 100_000) } : {}),
    timeMs: Math.max(0, Math.ceil((run.metrics.logicalTimeNs ?? 0) / 1_000_000)),
    ...(run.metrics.memoryBytes != null
      ? { memoryKb: Math.max(0, Math.ceil(run.metrics.memoryBytes / 1024)) }
      : {}),
    exitCode: run.code,
    termination: run.termination,
  };
}

export function browserCaseResult(
  run: BrowserCaseRun,
  expectedOutput: string | undefined,
  compare: CompareConfig | null | undefined,
  index: number,
): CaseResult {
  let verdict: CaseResult["verdict"] = run.verdict;
  if (verdict === "AC" && expectedOutput !== undefined) {
    verdict = compareStandard(run.stdout, expectedOutput, compare ?? {}) ? "AC" : "WA";
  }
  return {
    index,
    verdict,
    timeMs: run.timeMs,
    ...(run.memoryKb !== undefined ? { memoryKb: run.memoryKb } : {}),
    stdout: run.stdout.slice(0, 1_000_000),
    ...(run.stderr ? { stderr: run.stderr } : {}),
  };
}

export function mapBrowserLocalRunResult(
  run: RunResult,
  expectedOutput: string | undefined,
  compare: CompareConfig | null | undefined,
  index: number,
): CaseResult {
  return browserCaseResult(browserCaseRun(run), expectedOutput, compare, index);
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

function browserLocalErrorHint(message: string): string {
  if (/exceeded the \d+ ms browser boundary/.test(message))
    return m.editor_browserBuildTimeout();
  if (/Failed to fetch|NetworkError|Load failed|Unable to load/.test(message)) {
    return m.editor_toolchainUnavailable();
  }
  if (message.includes("cross-origin-isolated")) return m.editor_browserIsolationRequired();
  return "Browser local execution failed.";
}

export function browserLocalErrorResult(error: unknown): SubmissionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    accepted: false,
    caseResults: [],
    feedback: formatJudgeOutput(`${browserLocalErrorHint(message)}\n${message}`).slice(
      0,
      10_000,
    ),
    runtimeMs: 0,
    score: 0,
    verdict: "system_error",
  };
}

export function browserLocalSubmissionResult(caseResults: CaseResult[]): SubmissionResult {
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
}

export async function compileBrowserLocally(
  request: SubmissionRequest,
  problemId: string,
  signal: AbortSignal,
): Promise<BrowserCompileOutcome> {
  const browserEngine = await getBrowserEngine();
  const cancel = () => browserEngine.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const { entry, files } = browserLocalFiles(request);
    const build = await browserEngine.compile(
      {
        language: request.language,
        target: "wasip1",
        optimization: "release",
        entry,
        files,
        name: `NOJV local ${problemId}`,
        projectId: `nojv-local-browser-v1-${problemId}-${request.language}`,
      },
      { cache: true },
    );
    signal.throwIfAborted();
    if (!build.success || !build.artifact) {
      return {
        ok: false,
        result: {
          accepted: false,
          caseResults: [],
          feedback: compileFeedback(build),
          runtimeMs: 0,
          score: 0,
          verdict: "compile_error",
        },
      };
    }
    return { ok: true, artifact: build.artifact };
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export async function runBrowserCases(
  artifact: BuildArtifact,
  cases: readonly { input: string }[],
  limits: BrowserRunLimits,
  signal: AbortSignal,
): Promise<BrowserCaseRun[]> {
  const browserEngine = await getBrowserEngine();
  const cancel = () => browserEngine.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const logicalTimeLimitMs = effectiveTimeLimitMs(limits.timeLimitMs, limits.language);
    const runs: BrowserCaseRun[] = [];
    for (const testCase of cases) {
      const run = await browserEngine.run(artifact, {
        stdin: testCase.input,
        env: limits.env,
        resources: {
          logicalTimeLimitMs,
          memoryLimitBytes: limits.memoryLimitMb * 1024 * 1024,
          outputLimitBytes: MAX_EXECUTION_OUTPUT_BYTES,
          filesystemWriteLimitBytes: 64 * 1024 * 1024,
          filesystemEntryLimit: 4096,
        },
      });
      signal.throwIfAborted();
      runs.push(browserCaseRun(run));
    }
    return runs;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export async function runBrowserLocally(args: {
  request: SubmissionRequest;
  cases: SubmissionRunCase[];
  judgeConfig: JudgeConfig;
  problemId: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  signal: AbortSignal;
}): Promise<SubmissionResult | null> {
  try {
    args.signal.throwIfAborted();
    if (args.cases.length === 0) {
      return browserLocalErrorResult(new Error("No testcases were provided."));
    }
    const build = await compileBrowserLocally(args.request, args.problemId, args.signal);
    if (!build.ok) return build.result;
    const runs = await runBrowserCases(
      build.artifact,
      args.cases,
      {
        language: args.request.language,
        timeLimitMs: args.timeLimitMs,
        memoryLimitMb: args.memoryLimitMb,
        env: args.judgeConfig.runtime?.env ?? {},
      },
      args.signal,
    );
    return browserLocalSubmissionResult(
      runs.map((run, index) =>
        browserCaseResult(
          run,
          args.cases[index]?.expectedOutput,
          args.judgeConfig.compare,
          index,
        ),
      ),
    );
  } catch (error) {
    if (args.signal.aborted) return null;
    return browserLocalErrorResult(error);
  }
}
