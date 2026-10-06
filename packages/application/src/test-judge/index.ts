import { randomUUID } from "node:crypto";

import {
  interactiveContestantSupported,
  staticTestCapability,
  TEST_JUDGE_REQUEST_PREFIX,
  testJudgeResponseSchema,
  testJudgeStoredRequestSchema,
  type ProblemSample,
  type TestJudgeRequest,
  type TestJudgeResponse,
  type TestJudgeWorkflowOutput,
} from "@nojv/core";
import { problemRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";
import {
  assertStorageObjectPointer,
  deleteBlob,
  isStorageObjectNotFoundError,
  putImmutableText,
} from "@nojv/storage";

import { assertProblemContextAllowed } from "../code-draft";
import { buildProblemSamples } from "../problem/details";
import { judgeScriptLanguageOf, parsePersistedJudgeConfig } from "../problem/judge-config";
import type { ActorContext } from "../shared/actor-context";
import {
  ConflictError,
  HttpError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../shared/errors";
import { getDomainOrchestration } from "../shared/orchestration";
import { storage } from "../shared/storage-singleton";
import { isTestJudgeEnabled } from "../shared/test-judge-enabled";

const TEST_JUDGE_TIMEOUT_MS = 30_000;
const IN_FLIGHT_TTL_SECONDS = 90;
const RELEASE_IF_HELD = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

export async function withUserTestJudgeLock<T>(
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  const key = keys.testJudgeInFlight(userId);
  const token = randomUUID();
  let acquired: boolean;
  try {
    acquired = (await redis.set(key, token, "EX", IN_FLIGHT_TTL_SECONDS, "NX")) === "OK";
  } catch (error) {
    throw new ServiceUnavailableError("test_judge_unavailable", { cause: error });
  }
  if (!acquired) throw new HttpError("test_judge_busy", 429);
  try {
    return await run();
  } finally {
    await redis.eval(RELEASE_IF_HELD, 1, key, token).catch(() => undefined);
  }
}

async function deleteRequest(requestKey: string): Promise<void> {
  try {
    await deleteBlob(storage(), requestKey);
  } catch (error) {
    if (!isStorageObjectNotFoundError(error)) {
      console.warn("Could not delete a test-judge request", { requestKey, error });
    }
  }
}

function sampleAt(samples: ProblemSample[], index: number): ProblemSample {
  const sample = samples[index];
  if (!sample) throw new ValidationError("The requested sample does not exist.");
  return sample;
}

function interactorInputOf(sample: ProblemSample): string {
  if (!sample.interactorInput?.trim()) {
    throw new ValidationError("Sample has no interactor input.");
  }
  return sample.interactorInput;
}

function responseFor(output: TestJudgeWorkflowOutput): TestJudgeResponse {
  if (output.ok) return testJudgeResponseSchema.parse({ cases: output.cases });
  switch (output.code) {
    case "test_judge_busy":
    case "test_judge_unavailable":
      throw new ServiceUnavailableError(output.code);
    case "judge_program_build_failed":
    case "judge_program_unsupported":
      throw new ConflictError(output.code);
    default:
      throw new ServiceUnavailableError("test_judge_unavailable");
  }
}

export async function runTestJudge(
  actor: ActorContext,
  problemId: string,
  request: TestJudgeRequest,
  clientIp: string,
): Promise<TestJudgeResponse> {
  if (!isTestJudgeEnabled()) throw new ServiceUnavailableError("test_judge_unavailable");
  await assertProblemContextAllowed(
    actor,
    { context: request.context, problemId },
    new Date(),
    clientIp,
  );

  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError("Problem not found.");
  const judgeConfig = parsePersistedJudgeConfig(problem.judgeConfig, problem.id);
  if (request.kind !== judgeConfig.type) {
    throw new ValidationError("The Test request does not match the problem's judge type.");
  }
  const judgeLanguage = judgeScriptLanguageOf(judgeConfig);
  const capability = staticTestCapability({
    isSpecialEnv: problem.type === "special_env",
    judgeType: judgeConfig.type,
    judgeLanguage,
    testJudgeEnabled: true,
  });
  if (!capability.available) throw new ConflictError("judge_program_unsupported");
  if (request.kind === "interactive") {
    if (!interactiveContestantSupported(request.language)) {
      throw new ConflictError("judge_program_unsupported");
    }
    if (request.artifact.language !== request.language) {
      throw new ValidationError("The compiled program does not match the requested language.");
    }
  }
  const scriptPointer =
    request.kind === "checker" ? problem.checkerStorage : problem.interactorStorage;
  if (scriptPointer === null || judgeLanguage === null) {
    throw new ConflictError("judge_program_unsupported");
  }

  const samples = buildProblemSamples(problem);
  const shared = {
    judgeLanguage,
    judgeScriptPointer: assertStorageObjectPointer(scriptPointer),
    timeLimitMs: problem.timeLimitMs,
    memoryLimitMb: problem.memoryLimitMb,
    runtimeEnv: judgeConfig.runtime?.env ?? {},
  };
  const stored = testJudgeStoredRequestSchema.parse(
    request.kind === "checker"
      ? {
          kind: "checker",
          ...shared,
          cases: request.cases.map(({ sampleIndex, output }) => {
            const sample = sampleAt(samples, sampleIndex);
            return { input: sample.input, expectedOutput: sample.output, output };
          }),
        }
      : {
          kind: "interactive",
          ...shared,
          contestantLanguage: request.language,
          artifact: request.artifact,
          cases: request.cases.map(({ sampleIndex }) => ({
            interactorInput: interactorInputOf(sampleAt(samples, sampleIndex)),
          })),
        },
  );
  const requestKey = `${TEST_JUDGE_REQUEST_PREFIX}${randomUUID()}.json`;
  await putImmutableText(storage(), requestKey, JSON.stringify(stored));

  let output: TestJudgeWorkflowOutput;
  try {
    output = await getDomainOrchestration().runTestJudge(
      { requestKey },
      { timeoutMs: TEST_JUDGE_TIMEOUT_MS },
    );
  } catch (error) {
    console.warn("Test-judge workflow failed", { requestKey, error });
    throw new ServiceUnavailableError("test_judge_unavailable", { cause: error });
  } finally {
    await deleteRequest(requestKey);
  }
  return responseFor(output);
}
