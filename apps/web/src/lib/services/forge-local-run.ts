import {
  compareStandard,
  entryFileNameFor,
  type CaseResult,
  type CompareConfig,
  type Language,
  type SubmissionResult,
  type SubmissionRunCase,
} from "@nojv/core";
import type { BuildResult, ForgeEngine, RunResult } from "@wasm-oj/forge/browser";
import type { SubmissionRequest } from "./submission-service";

const FORGE_LANGUAGES = new Set<Language>([
  "c",
  "cpp",
  "go",
  "javascript",
  "python",
  "rust",
  "typescript",
]);

let forgePromise: Promise<ForgeEngine> | undefined;

export function supportsForgeLocalRun(language: Language): boolean {
  return FORGE_LANGUAGES.has(language);
}

async function getForge(): Promise<ForgeEngine> {
  forgePromise ??= import("@wasm-oj/forge/browser")
    .then(({ Forge }) =>
      Forge.create({ assetBaseUrl: "/forge/toolchains/", artifactCache: true }),
    )
    .catch((error: unknown) => {
      forgePromise = undefined;
      throw error;
    });
  return forgePromise;
}

export function forgeFiles(request: SubmissionRequest): {
  entry: string;
  files: Record<string, string>;
} {
  if (request.sourceFiles && request.sourceFiles.length > 0) {
    return {
      entry: entryFileNameFor(request.language),
      files: Object.fromEntries(request.sourceFiles.map((file) => [file.path, file.content])),
    };
  }
  const entry = entryFileNameFor(request.language);
  return { entry, files: { [entry]: request.sourceCode } };
}

export function forgeTerminationVerdict(
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

export function mapForgeRunResult(
  run: RunResult,
  expectedOutput: string | undefined,
  compare: CompareConfig | null | undefined,
  index: number,
): CaseResult {
  let verdict = forgeTerminationVerdict(run.termination, run.code);
  if (verdict === "AC" && expectedOutput !== undefined) {
    verdict = compareStandard(run.stdout, expectedOutput, compare ?? {}) ? "AC" : "WA";
  }
  return {
    index,
    verdict,
    timeMs: Math.max(0, Math.round(run.durationMs)),
    ...(run.metrics.memoryBytes != null
      ? { memoryKb: Math.max(0, Math.ceil(run.metrics.memoryBytes / 1024)) }
      : {}),
    stdout: run.stdout.slice(0, 1_000_000),
    ...(run.stderr ? { stderr: run.stderr.slice(0, 100_000) } : {}),
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
  return (build.stderr || build.stdout || diagnostics || "Compilation failed.").slice(
    0,
    10_000,
  );
}

export async function runForgeLocally(args: {
  request: SubmissionRequest;
  cases: SubmissionRunCase[];
  compare: CompareConfig | null | undefined;
  problemId: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  signal: AbortSignal;
}): Promise<SubmissionResult | null> {
  const forge = await getForge();
  const cancel = () => forge.cancel();
  args.signal.addEventListener("abort", cancel, { once: true });

  try {
    if (args.signal.aborted) return null;
    const { entry, files } = forgeFiles(args.request);
    const build = await forge.compile(
      {
        language: args.request.language,
        target: "wasip1",
        optimization: "release",
        entry,
        files,
        name: `NOJV local ${args.problemId}`,
        projectId: `nojv-local-${args.problemId}-${args.request.language}`,
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
      const run = await forge.run(build.artifact, {
        stdin: testCase.input,
        resources: {
          logicalTimeLimitMs: args.timeLimitMs,
          memoryLimitBytes: args.memoryLimitMb * 1024 * 1024,
          outputLimitBytes: 1_000_000,
          filesystemWriteLimitBytes: 64 * 1024 * 1024,
          filesystemEntryLimit: 4096,
          wallTimeLimitMs: Math.min(600_000, Math.max(1_000, args.timeLimitMs * 3)),
        },
      });
      caseResults.push(mapForgeRunResult(run, testCase.expectedOutput, args.compare, index));
    }

    const runtimeMs = caseResults.reduce((max, result) => Math.max(max, result.timeMs), 0);
    const accepted = caseResults.every((result) => result.verdict === "AC");
    return {
      accepted,
      caseResults,
      feedback: accepted ? "Forge local run completed." : "One or more test cases failed.",
      runtimeMs,
      memoryKb: caseResults.reduce((max, result) => Math.max(max, result.memoryKb ?? 0), 0),
      score: accepted ? 100 : 0,
      verdict: submissionVerdict(caseResults),
    };
  } catch (error) {
    if (args.signal.aborted) return null;
    throw error;
  } finally {
    args.signal.removeEventListener("abort", cancel);
  }
}
