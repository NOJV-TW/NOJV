import {
  DEFAULT_MAX_MEMORY_MB,
  DEFAULT_MEMORY_HEADROOM_MB,
  MAX_CASE_STDERR_BYTES,
  MAX_EXECUTION_OUTPUT_BYTES,
  checkerCaseVerdict,
  compareStandard,
  entryFileNameFor,
  effectiveTimeLimitMs,
  executionWallTimeLimitMs,
  interactiveCaseVerdict,
  isBrowserLocalLanguage,
  judgeProgramCompileInput,
  resolveContainerMemoryMb,
  truncateUtf8,
  validatorTimeoutMs,
  wasmOjTerminationVerdict,
  withCppPlatformHeaders,
  type CaseResult,
  type CompareConfig,
  type JudgeConfig,
  type JudgeProgramSource,
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
const PRELOAD_RETRY_DELAYS_MS = [2_000, 5_000];
const JUDGE_PROGRAM_ARGS = ["/judge/input", "/judge/answer", "/judge/feedback"];
const CHECKER_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
const CHECKER_TEAM_MESSAGE_PATH = "/judge/feedback/teammessage.txt";
const MIN_INTERACTIVE_WALL_LIMIT_MS = 3_000;
const INTERACTION_TRANSCRIPT_BYTES = 64 * 1024;
const RUN_OUTPUT_LIMITS = {
  outputLimitBytes: MAX_EXECUTION_OUTPUT_BYTES,
  filesystemWriteLimitBytes: 64 * 1024 * 1024,
  filesystemEntryLimit: 4096,
};
let browserEnginePromise: Promise<Engine> | undefined;
let engineQueueTail: Promise<void> = Promise.resolve();

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

async function waitForTurn(previous: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let leave!: () => void;
  const left = new Promise<void>((resolve) => (leave = resolve));
  signal.addEventListener("abort", leave, { once: true });
  try {
    await Promise.race([previous, left]);
  } finally {
    signal.removeEventListener("abort", leave);
  }
  signal.throwIfAborted();
}

async function withBrowserEngine<T>(
  signal: AbortSignal,
  operation: (engine: Engine) => Promise<T>,
  { cancelOnAbort = true } = {},
): Promise<T> {
  const previous = engineQueueTail;
  let finish!: () => void;
  engineQueueTail = new Promise<void>((resolve) => (finish = resolve));
  try {
    await waitForTurn(previous, signal);
  } catch (error) {
    void previous.then(finish);
    throw error;
  }
  try {
    const engine = await getBrowserEngine();
    signal.throwIfAborted();
    if (!cancelOnAbort) return await operation(engine);
    const cancel = () => engine.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await operation(engine);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  } finally {
    finish();
  }
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
  preload.promise = withPreloadRetries(() =>
    prefetchBrowserToolchain(BROWSER_TOOLCHAINS, {
      language,
      libcxxPrecompiledHeader: language === "cpp",
      onProgress: (progress) => {
        preload.progress = progress;
        for (const listener of preload.listeners) listener(progress);
      },
    }),
  )
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

export async function withPreloadRetries<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const delay = PRELOAD_RETRY_DELAYS_MS[attempt];
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

interface BrowserCaseRun {
  verdict: ReturnType<typeof wasmOjTerminationVerdict>;
  stdout: string;
  stderr?: string;
  timeMs: number;
  memoryKb?: number;
  exitCode: number;
  termination: RunResult["termination"];
}

interface BrowserRunLimits {
  language: Language;
  timeLimitMs: number;
  memoryLimitMb: number;
  env: Record<string, string>;
}

interface BrowserInteraction {
  verdict: ReturnType<typeof interactiveCaseVerdict>["verdict"];
  timeMs: number;
  transcript: { toInteractor: string; toContestant: string };
  stderr?: string;
}

type BrowserCompileOutcome =
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
    case "SE":
      return "system_error";
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
  return withBrowserEngine(signal, async (browserEngine) => {
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
  });
}

export async function compileBrowserJudgeProgram(
  problemId: string,
  program: JudgeProgramSource,
  signal: AbortSignal,
): Promise<{ ok: true; artifact: BuildArtifact } | { ok: false; diagnostics: string }> {
  return withBrowserEngine(
    signal,
    async (browserEngine) => {
      const build = await browserEngine.compile(
        {
          ...judgeProgramCompileInput(program, WASM_OJ_LIBCXX_PCH_HEADER),
          target: "wasip1",
          optimization: "release",
          name: `NOJV ${program.role} ${problemId}`,
          projectId: `nojv-judge-program-v1-${problemId}-${program.role}-${program.language}`,
        },
        { cache: true },
      );
      if (!build.success || !build.artifact)
        return { ok: false, diagnostics: compileFeedback(build) };
      return { ok: true, artifact: build.artifact };
    },
    { cancelOnAbort: false },
  );
}

export async function runBrowserCases(
  artifact: BuildArtifact,
  cases: readonly { input: string }[],
  limits: BrowserRunLimits,
  signal: AbortSignal,
): Promise<BrowserCaseRun[]> {
  return withBrowserEngine(signal, async (browserEngine) => {
    const logicalTimeLimitMs = effectiveTimeLimitMs(limits.timeLimitMs, limits.language);
    const runs: BrowserCaseRun[] = [];
    for (const testCase of cases) {
      const run = await browserEngine.run(artifact, {
        stdin: testCase.input,
        env: limits.env,
        resources: {
          logicalTimeLimitMs,
          memoryLimitBytes: limits.memoryLimitMb * 1024 * 1024,
          ...RUN_OUTPUT_LIMITS,
        },
      });
      signal.throwIfAborted();
      runs.push(browserCaseRun(run));
    }
    return runs;
  });
}

export async function runBrowserChecker(
  artifact: BuildArtifact,
  {
    input,
    answer,
    output,
    timeLimitMs,
  }: { input: string; answer: string; output: string; timeLimitMs: number },
  signal: AbortSignal,
): Promise<ReturnType<typeof checkerCaseVerdict>> {
  return withBrowserEngine(signal, async (browserEngine) => {
    const timeoutMs = validatorTimeoutMs(timeLimitMs);
    const run = await browserEngine.run(artifact, {
      args: JUDGE_PROGRAM_ARGS,
      stdin: output,
      files: {
        "/judge/input": input,
        "/judge/answer": answer,
        "/judge/feedback/.keep": "",
      },
      outputPaths: [CHECKER_TEAM_MESSAGE_PATH],
      resources: {
        logicalTimeLimitMs: timeoutMs,
        memoryLimitBytes: CHECKER_MEMORY_LIMIT_BYTES,
        wallTimeLimitMs: executionWallTimeLimitMs(timeoutMs),
        ...RUN_OUTPUT_LIMITS,
      },
    });
    signal.throwIfAborted();
    const teamMessage = run.files[CHECKER_TEAM_MESSAGE_PATH];
    return checkerCaseVerdict(
      run,
      teamMessage === undefined ? undefined : new TextDecoder().decode(teamMessage),
    );
  });
}

export async function runBrowserInteraction(
  contestant: BuildArtifact,
  interactor: BuildArtifact,
  { interactorInput, limits }: { interactorInput: string; limits: BrowserRunLimits },
  signal: AbortSignal,
): Promise<BrowserInteraction> {
  return withBrowserEngine(signal, async (browserEngine) => {
    const timeLimitMs = effectiveTimeLimitMs(limits.timeLimitMs, limits.language);
    const wallTimeLimitMs = Math.max(MIN_INTERACTIVE_WALL_LIMIT_MS, 3 * timeLimitMs);
    const interactorMemoryMb = resolveContainerMemoryMb(limits.memoryLimitMb, {
      defaultMemoryMb: limits.memoryLimitMb,
      headroomMb: DEFAULT_MEMORY_HEADROOM_MB,
      maxMemoryMb: DEFAULT_MAX_MEMORY_MB,
    });
    const run = await browserEngine.interact(contestant, interactor, {
      contestant: {
        env: limits.env,
        resources: {
          logicalTimeLimitMs: timeLimitMs,
          memoryLimitBytes: limits.memoryLimitMb * 1024 * 1024,
          wallTimeLimitMs,
          ...RUN_OUTPUT_LIMITS,
        },
      },
      interactor: {
        args: JUDGE_PROGRAM_ARGS,
        files: {
          "/judge/input": interactorInput,
          "/judge/answer": "",
          "/judge/feedback/.keep": "",
        },
        resources: {
          logicalTimeLimitMs: validatorTimeoutMs(timeLimitMs),
          memoryLimitBytes: interactorMemoryMb * 1024 * 1024,
          wallTimeLimitMs,
          ...RUN_OUTPUT_LIMITS,
        },
      },
    });
    signal.throwIfAborted();
    const stderr = truncateUtf8(run.contestant.stderr, MAX_CASE_STDERR_BYTES);
    return {
      verdict: interactiveCaseVerdict(run).verdict,
      timeMs: Math.max(0, Math.ceil((run.contestant.metrics.logicalTimeNs ?? 0) / 1_000_000)),
      transcript: {
        toInteractor: truncateUtf8(run.contestantToInteractor, INTERACTION_TRANSCRIPT_BYTES),
        toContestant: truncateUtf8(run.interactorToContestant, INTERACTION_TRANSCRIPT_BYTES),
      },
      ...(stderr ? { stderr } : {}),
    };
  });
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
