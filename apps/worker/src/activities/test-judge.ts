import {
  boundedTestJudgeOutput,
  checkerCaseVerdict,
  deserialiseBuildArtifact,
  effectiveTimeLimitMs,
  interactiveCaseVerdict,
  MAX_CASE_STDERR_BYTES,
  MAX_EXECUTION_OUTPUT_BYTES,
  serialisedArtifactBytes,
  TEST_JUDGE_MAX_ARTIFACT_BYTES,
  TEST_JUDGE_TRANSCRIPT_BYTES,
  testJudgeCaseResultSchema,
  testJudgeStoredRequestSchema,
  truncateUtf8,
  validatorTimeoutMs,
  type TestJudgeCaseResult,
  type TestJudgeProgramBuildInput,
  type TestJudgeStoredRequest,
  type TestJudgeWorkflowInput,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import {
  deleteBlob,
  getText,
  getVerifiedText,
  isStorageObjectNotFoundError,
  StorageIntegrityError,
  TEST_JUDGE_REQUEST_PREFIX,
  type createStorageClient,
} from "@nojv/storage";
import { Context } from "@temporalio/activity";
import type { BuildArtifact } from "@wasm-oj/core";

import { createLogger } from "../logger.js";
import {
  getJudgeProgram,
  readCachedJudgeProgram,
  type JudgeProgram,
  type JudgeProgramStore,
} from "../test-judge/judge-program";
import type { EngineLease, TestJudgeEngine } from "../test-judge/runtime";

const logger = createLogger("test-judge");

// ponytail: one 24 s budget per request keeps the awaited workflow inside web's 30 s deadline; stream per-case results to lift it
const REQUEST_BUDGET_MS = 24_000;
const CHECKER_WALL_LIMIT_MS = 10_000;
const MIN_INTERACTIVE_WALL_LIMIT_MS = 3_000;
const MIB = 1024 * 1024;
const CHECKER_MEMORY_BYTES = 512 * MIB;
const INTERACTOR_MEMORY_BYTES = 256 * MIB;
const JUDGE_PROGRAM_ARGS = ["/judge/input", "/judge/answer", "/judge/feedback"];
const TEAM_MESSAGE_PATH = "/judge/feedback/teammessage.txt";
const BUSY: TestJudgeWorkflowOutput = { ok: false, code: "test_judge_busy" };

type ScriptPointer = TestJudgeStoredRequest["judgeScriptPointer"];
type JudgeEngine = Pick<TestJudgeEngine, "compile" | "run" | "interact" | "cancel">;
type CheckerRequest = Extract<TestJudgeStoredRequest, { kind: "checker" }>;
type InteractiveRequest = Extract<TestJudgeStoredRequest, { kind: "interactive" }>;

export interface TestJudgeStorage {
  getText(key: string): Promise<string>;
  getVerifiedText(pointer: ScriptPointer): Promise<string>;
  deleteBlob(key: string): Promise<void>;
}

export interface TestJudgeDeps {
  pool: { acquire(): Promise<EngineLease<JudgeEngine>> };
  storage: TestJudgeStorage;
  programs: JudgeProgramStore;
}

let deps: TestJudgeDeps | null = null;

export function setTestJudgeDeps(next: TestJudgeDeps): void {
  deps = next;
}

function requireDeps(): TestJudgeDeps {
  if (!deps) throw new Error("Test-judge activities are not configured.");
  return deps;
}

export function objectStorageTestJudgeStorage(
  client: ReturnType<typeof createStorageClient>,
): TestJudgeStorage {
  return {
    getText: (key) => getText(client, key),
    getVerifiedText: (pointer) => getVerifiedText(client, pointer),
    deleteBlob: (key) => deleteBlob(client, key),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readRequest(
  storage: TestJudgeStorage,
  requestKey: string,
): Promise<TestJudgeStoredRequest | null> {
  try {
    return testJudgeStoredRequestSchema.parse(JSON.parse(await storage.getText(requestKey)));
  } catch (error) {
    logger.warn("Could not read a test-judge request", {
      requestKey,
      error: errorMessage(error),
    });
    return null;
  }
}

async function readJudgeSource(
  storage: TestJudgeStorage,
  pointer: ScriptPointer,
): Promise<string | null> {
  try {
    return await storage.getVerifiedText(pointer);
  } catch (error) {
    if (!(error instanceof StorageIntegrityError) && !isStorageObjectNotFoundError(error)) {
      throw error;
    }
    logger.error("A test-judge program source is missing or corrupt", {
      key: pointer.key,
      error: errorMessage(error),
    });
    return null;
  }
}

async function judgeCheckerCase(
  engine: JudgeEngine,
  checker: BuildArtifact,
  request: CheckerRequest,
  testCase: CheckerRequest["cases"][number],
  remainingMs: number,
): Promise<TestJudgeCaseResult | null> {
  const wallTimeLimitMs = Math.min(CHECKER_WALL_LIMIT_MS, remainingMs);
  const run = await engine.run(checker, {
    args: JUDGE_PROGRAM_ARGS,
    stdin: testCase.output,
    env: {},
    files: {
      "/judge/input": testCase.input,
      "/judge/answer": testCase.expectedOutput,
      "/judge/feedback/.keep": "",
    },
    outputPaths: [TEAM_MESSAGE_PATH],
    resources: {
      logicalTimeLimitMs: validatorTimeoutMs(request.timeLimitMs),
      memoryLimitBytes: CHECKER_MEMORY_BYTES,
      wallTimeLimitMs,
    },
  });
  if (run.termination === "wall-time-limit" && wallTimeLimitMs < CHECKER_WALL_LIMIT_MS) {
    return null;
  }
  const teamMessage = run.files[TEAM_MESSAGE_PATH];
  return checkerCaseVerdict(run, teamMessage && new TextDecoder().decode(teamMessage));
}

async function judgeInteractiveCase(
  engine: JudgeEngine,
  interactor: BuildArtifact,
  contestant: BuildArtifact,
  request: InteractiveRequest,
  testCase: InteractiveRequest["cases"][number],
  remainingMs: number,
): Promise<TestJudgeCaseResult | null> {
  const timeLimitMs = effectiveTimeLimitMs(request.timeLimitMs, request.contestantLanguage);
  const fullWallMs = Math.max(MIN_INTERACTIVE_WALL_LIMIT_MS, 3 * timeLimitMs);
  const wallTimeLimitMs = Math.min(fullWallMs, remainingMs);
  const run = await engine.interact(contestant, interactor, {
    contestant: {
      env: request.runtimeEnv,
      resources: {
        logicalTimeLimitMs: timeLimitMs,
        memoryLimitBytes: request.memoryLimitMb * MIB,
        outputLimitBytes: MAX_EXECUTION_OUTPUT_BYTES,
        filesystemWriteLimitBytes: 64 * MIB,
        filesystemEntryLimit: 4096,
        wallTimeLimitMs,
      },
    },
    interactor: {
      args: JUDGE_PROGRAM_ARGS,
      files: {
        "/judge/input": testCase.interactorInput,
        "/judge/answer": "",
        "/judge/feedback/.keep": "",
      },
      resources: {
        logicalTimeLimitMs: validatorTimeoutMs(timeLimitMs),
        memoryLimitBytes: INTERACTOR_MEMORY_BYTES,
        wallTimeLimitMs,
      },
    },
  });
  const wallStopped =
    run.contestant.termination === "wall-time-limit" ||
    run.interactor.termination === "wall-time-limit";
  if (wallStopped && wallTimeLimitMs < fullWallMs) return null;
  let { verdict } = interactiveCaseVerdict(run);
  if (run.contestant.termination === "wall-time-limit") verdict = "TLE";
  const contestantStderr = truncateUtf8(run.contestant.stderr, MAX_CASE_STDERR_BYTES);
  return {
    verdict,
    ...(contestantStderr ? { contestantStderr } : {}),
    transcript: {
      toInteractor: truncateUtf8(run.contestantToInteractor, TEST_JUDGE_TRANSCRIPT_BYTES),
      toContestant: truncateUtf8(run.interactorToContestant, TEST_JUDGE_TRANSCRIPT_BYTES),
    },
    timeMs: Math.max(0, Math.ceil((run.contestant.metrics.logicalTimeNs ?? 0) / 1_000_000)),
  };
}

async function judgeCases<C>(
  cases: readonly C[],
  deadline: number,
  stop: AbortSignal,
  judge: (testCase: C, remainingMs: number) => Promise<TestJudgeCaseResult | null>,
): Promise<TestJudgeCaseResult[] | null> {
  const results: TestJudgeCaseResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;
    try {
      stop.throwIfAborted();
      const result = await judge(testCase, remainingMs);
      if (result === null) return null;
      results.push(testJudgeCaseResultSchema.parse(result));
    } catch (error) {
      if (stop.aborted) return null;
      logger.error("Test-judge case failed", { index, error: errorMessage(error) });
      results.push({ verdict: "SE" });
    }
  }
  return results;
}

function systemErrors(count: number): TestJudgeWorkflowOutput {
  return { ok: true, cases: Array.from({ length: count }, () => ({ verdict: "SE" })) };
}

async function judgeWithProgram(
  { pool, storage, programs }: TestJudgeDeps,
  request: TestJudgeStoredRequest,
  stop: AbortSignal,
  judge: (engine: JudgeEngine, program: BuildArtifact) => Promise<TestJudgeCaseResult[] | null>,
): Promise<TestJudgeWorkflowOutput> {
  const source = await readJudgeSource(storage, request.judgeScriptPointer);
  if (source === null) return { ok: false, code: "test_judge_unavailable" };

  const lease = await pool.acquire();
  const cancel = () => lease.engine.cancel();
  stop.addEventListener("abort", cancel, { once: true });
  try {
    let program: JudgeProgram;
    try {
      stop.throwIfAborted();
      program = await getJudgeProgram(
        { engine: lease.engine, store: programs },
        {
          role: request.kind === "checker" ? "checker" : "interactor",
          language: request.judgeLanguage,
          source,
        },
      );
    } catch (error) {
      if (!stop.aborted) throw error;
      return BUSY;
    }
    if (!program.ok) return { ok: false, code: "judge_program_build_failed" };
    const cases = await judge(lease.engine, program.artifact);
    return cases ? boundedTestJudgeOutput(cases) : BUSY;
  } finally {
    stop.removeEventListener("abort", cancel);
    lease.release();
  }
}

async function judgeRequest(
  current: TestJudgeDeps,
  request: TestJudgeStoredRequest,
  deadline: number,
  stop: AbortSignal,
): Promise<TestJudgeWorkflowOutput> {
  if (request.kind === "checker") {
    return await judgeWithProgram(current, request, stop, (engine, checker) =>
      judgeCases(request.cases, deadline, stop, (testCase, remainingMs) =>
        judgeCheckerCase(engine, checker, request, testCase, remainingMs),
      ),
    );
  }
  if (request.judgeLanguage === "python") {
    return { ok: false, code: "judge_program_unsupported" };
  }
  if (serialisedArtifactBytes(request.artifact) > TEST_JUDGE_MAX_ARTIFACT_BYTES) {
    return systemErrors(request.cases.length);
  }
  const contestant = deserialiseBuildArtifact(request.artifact) as BuildArtifact;
  return await judgeWithProgram(current, request, stop, (engine, interactor) =>
    judgeCases(request.cases, deadline, stop, (testCase, remainingMs) =>
      judgeInteractiveCase(engine, interactor, contestant, request, testCase, remainingMs),
    ),
  );
}

export async function runTestJudge({
  requestKey,
}: TestJudgeWorkflowInput): Promise<TestJudgeWorkflowOutput> {
  const context = Context.current();
  const deadline = Math.min(Date.now(), context.info.scheduledTimestampMs) + REQUEST_BUDGET_MS;
  if (!requestKey.startsWith(TEST_JUDGE_REQUEST_PREFIX)) {
    logger.error("Refusing a test-judge request outside the request prefix", { requestKey });
    return { ok: false, code: "test_judge_unavailable" };
  }
  const stop = AbortSignal.any([
    context.cancellationSignal,
    AbortSignal.timeout(Math.max(0, deadline - Date.now())),
  ]);
  const current = requireDeps();
  try {
    const request = await readRequest(current.storage, requestKey);
    if (!request) return { ok: false, code: "test_judge_unavailable" };
    return await judgeRequest(current, request, deadline, stop);
  } finally {
    await current.storage.deleteBlob(requestKey).catch((error: unknown) => {
      logger.warn("Could not delete a test-judge request", {
        requestKey,
        error: errorMessage(error),
      });
    });
  }
}

export async function buildTestJudgeProgram({
  role,
  language,
  scriptPointer,
}: TestJudgeProgramBuildInput): Promise<void> {
  const { pool, storage, programs } = requireDeps();
  const program = { role, language, source: await storage.getVerifiedText(scriptPointer) };
  if (await readCachedJudgeProgram(programs, program)) return;
  const lease = await pool.acquire();
  try {
    await getJudgeProgram({ engine: lease.engine, store: programs }, program, {
      throwOnStoreError: true,
    });
  } finally {
    lease.release();
  }
}
