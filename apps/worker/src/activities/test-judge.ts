import {
  checkerCaseVerdict,
  deserialiseBuildArtifact,
  effectiveTimeLimitMs,
  interactiveCaseVerdict,
  MAX_CASE_STDERR_BYTES,
  MAX_EXECUTION_OUTPUT_BYTES,
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
import { deleteBlob, getText, getVerifiedText, type createStorageClient } from "@nojv/storage";
import type { BuildArtifact } from "@wasm-oj/core";

import { createLogger } from "../logger.js";
import { getJudgeProgram, type JudgeProgramStore } from "../test-judge/judge-program";
import type { EngineLease, TestJudgeEngine } from "../test-judge/runtime";

const logger = createLogger("test-judge");

// ponytail: one 24 s budget per request keeps the awaited workflow inside web's 30 s deadline; stream per-case results to lift it
const REQUEST_BUDGET_MS = 24_000;
const CASE_WALL_LIMIT_MS = 10_000;
const MIB = 1024 * 1024;
const JUDGE_PROGRAM_MEMORY_BYTES = 512 * MIB;
const JUDGE_PROGRAM_ARGS = ["/judge/input", "/judge/answer", "/judge/feedback"];
const TEAM_MESSAGE_PATH = "/judge/feedback/teammessage.txt";

type ScriptPointer = TestJudgeStoredRequest["judgeScriptPointer"];
type JudgeEngine = Pick<TestJudgeEngine, "compile" | "run" | "interact">;
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

function judgeProgramResources(timeLimitMs: number, wallTimeLimitMs: number) {
  return {
    logicalTimeLimitMs: validatorTimeoutMs(timeLimitMs),
    memoryLimitBytes: JUDGE_PROGRAM_MEMORY_BYTES,
    wallTimeLimitMs,
  };
}

async function judgeCheckerCase(
  engine: JudgeEngine,
  checker: BuildArtifact,
  request: CheckerRequest,
  testCase: CheckerRequest["cases"][number],
  wallTimeLimitMs: number,
): Promise<TestJudgeCaseResult> {
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
    resources: judgeProgramResources(request.timeLimitMs, wallTimeLimitMs),
  });
  const teamMessage = run.files[TEAM_MESSAGE_PATH];
  return checkerCaseVerdict(run, teamMessage && new TextDecoder().decode(teamMessage));
}

async function judgeInteractiveCase(
  engine: JudgeEngine,
  interactor: BuildArtifact,
  contestant: BuildArtifact,
  request: InteractiveRequest,
  testCase: InteractiveRequest["cases"][number],
  wallTimeLimitMs: number,
): Promise<TestJudgeCaseResult> {
  const run = await engine.interact(contestant, interactor, {
    contestant: {
      env: request.runtimeEnv,
      resources: {
        logicalTimeLimitMs: effectiveTimeLimitMs(
          request.timeLimitMs,
          request.contestantLanguage,
        ),
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
      resources: judgeProgramResources(request.timeLimitMs, wallTimeLimitMs),
    },
  });
  const contestantStderr = truncateUtf8(run.contestant.stderr, MAX_CASE_STDERR_BYTES);
  return {
    verdict: interactiveCaseVerdict(run).verdict,
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
  judge: (testCase: C, wallTimeLimitMs: number) => Promise<TestJudgeCaseResult>,
): Promise<TestJudgeCaseResult[]> {
  const results: TestJudgeCaseResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      results.push({ verdict: "SE" });
      continue;
    }
    try {
      const result = await judge(testCase, Math.min(CASE_WALL_LIMIT_MS, remainingMs));
      results.push(testJudgeCaseResultSchema.parse(result));
    } catch (error) {
      logger.error("Test-judge case failed", { index, error: errorMessage(error) });
      results.push({ verdict: "SE" });
    }
  }
  return results;
}

function isOversized(artifact: BuildArtifact): boolean {
  return artifact.kind === "wasm" && artifact.bytes.byteLength > TEST_JUDGE_MAX_ARTIFACT_BYTES;
}

async function withJudgeProgram(
  { pool, storage, programs }: TestJudgeDeps,
  request: TestJudgeStoredRequest,
  judge: (engine: JudgeEngine, program: BuildArtifact) => Promise<TestJudgeCaseResult[]>,
): Promise<TestJudgeWorkflowOutput> {
  let source: string;
  try {
    source = await storage.getVerifiedText(request.judgeScriptPointer);
  } catch (error) {
    logger.error("Could not read a test-judge program source", {
      key: request.judgeScriptPointer.key,
      error: errorMessage(error),
    });
    return { ok: false, code: "test_judge_unavailable" };
  }

  const lease = await pool.acquire();
  try {
    const program = await getJudgeProgram(
      { engine: lease.engine, store: programs },
      {
        role: request.kind === "checker" ? "checker" : "interactor",
        language: request.judgeLanguage,
        source,
      },
    );
    if (!program.ok) return { ok: false, code: "judge_program_build_failed" };
    return { ok: true, cases: await judge(lease.engine, program.artifact) };
  } finally {
    lease.release();
  }
}

async function judgeRequest(
  current: TestJudgeDeps,
  request: TestJudgeStoredRequest,
  deadline: number,
): Promise<TestJudgeWorkflowOutput> {
  if (request.kind === "checker") {
    return await withJudgeProgram(current, request, (engine, checker) =>
      judgeCases(request.cases, deadline, (testCase, wallTimeLimitMs) =>
        judgeCheckerCase(engine, checker, request, testCase, wallTimeLimitMs),
      ),
    );
  }
  if (request.judgeLanguage === "python") {
    return { ok: false, code: "judge_program_unsupported" };
  }
  const contestant = deserialiseBuildArtifact(request.artifact) as BuildArtifact;
  if (isOversized(contestant)) {
    return { ok: true, cases: request.cases.map(() => ({ verdict: "SE" })) };
  }
  return await withJudgeProgram(current, request, (engine, interactor) =>
    judgeCases(request.cases, deadline, (testCase, wallTimeLimitMs) =>
      judgeInteractiveCase(engine, interactor, contestant, request, testCase, wallTimeLimitMs),
    ),
  );
}

export async function runTestJudge({
  requestKey,
}: TestJudgeWorkflowInput): Promise<TestJudgeWorkflowOutput> {
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const current = requireDeps();
  try {
    const request = await readRequest(current.storage, requestKey);
    if (!request) return { ok: false, code: "test_judge_unavailable" };
    return await judgeRequest(current, request, deadline);
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
  const source = await storage.getVerifiedText(scriptPointer);
  const lease = await pool.acquire();
  try {
    await getJudgeProgram(
      { engine: lease.engine, store: programs },
      { role, language, source },
    );
  } finally {
    lease.release();
  }
}
