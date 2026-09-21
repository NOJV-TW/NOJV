import { hostname } from "node:os";
import { ApplicationFailure, cancellationSignal, heartbeat } from "@temporalio/activity";
import { KubeConfig, NodeV1Api } from "@kubernetes/client-node";
import {
  createStorageClient,
  putImmutableText,
  getVerifiedText,
  deleteBlobsByPrefix,
  type StorageObjectPointer,
} from "@nojv/storage";
import { submissionDomain } from "@nojv/application";
import type { Language, SandboxRequest, SandboxResult } from "@nojv/core";
import {
  K8sExecutor,
  resolveK8sMemoryLimit,
  type PreparedArtifactReference,
} from "../services/k8s-executor";
import { parseResourceQuantity } from "../services/judge-capacity";
import { parseWorkerEnv } from "../env";
import { buildPinnedSandboxRequest } from "./judge-request";
import { recordJudgePhase, type JudgePhase } from "../services/judge-phase-metrics";

function executor(nodeName?: string): K8sExecutor {
  const env = parseWorkerEnv(process.env);
  if (env.EXECUTION_BACKEND !== "kubernetes")
    throw new Error("Staged judging requires Kubernetes");
  return new K8sExecutor({
    namespace: env.K8S_NAMESPACE,
    image: env.SANDBOX_IMAGE,
    cpuRequest: "1",
    caseCpuRequest: "1",
    cpuLimit: "1",
    memoryRequest: "1536Mi",
    memoryLimit: env.K8S_MEMORY_LIMIT,
    headroomMb: env.SANDBOX_MEMORY_HEADROOM_MB,
    maxMemoryMb: env.SANDBOX_MAX_MEMORY_MB,
    runtimeClassName: "gvisor",
    artifactStorageClassName: env.K8S_ARTIFACT_STORAGE_CLASS,
    ...(nodeName ? { admissionNode: nodeName } : {}),
    ...(env.K8S_IMAGE_PULL_SECRET ? { imagePullSecretName: env.K8S_IMAGE_PULL_SECRET } : {}),
  });
}
function prefix(runId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Invalid attempt run ID");
  return `judge-attempts/${runId}/`;
}
async function write(runId: string, name: string, data: unknown) {
  const client = createStorageClient();
  try {
    return await putImmutableText(client, `${prefix(runId)}${name}.json`, JSON.stringify(data));
  } finally {
    client.destroy();
  }
}
async function read<T>(pointer: StorageObjectPointer): Promise<T> {
  const client = createStorageClient();
  try {
    return JSON.parse(await getVerifiedText(client, pointer)) as T;
  } finally {
    client.destroy();
  }
}
async function dataFor(pointer: StorageObjectPointer) {
  return read<{ request: SandboxRequest; useAdvanced: boolean }>(pointer);
}
export interface CapacityLease {
  executionId: string;
  workflowId: string;
  runId: string;
}
async function running<T>(
  run: (signal: AbortSignal) => Promise<T>,
  lease?: CapacityLease,
): Promise<T> {
  if (
    lease &&
    !(await submissionDomain.heartbeatJudgeStage(
      lease.executionId,
      lease.workflowId,
      lease.runId,
      hostname(),
    ))
  )
    throw ApplicationFailure.nonRetryable(
      "Execution ownership changed",
      "JudgeExecutionObsolete",
    );
  heartbeat("stage-started");
  const controller = new AbortController();
  const signal = AbortSignal.any([cancellationSignal(), controller.signal]);
  let heartbeatPending = false;
  const timer = setInterval(() => {
    heartbeat("stage-running");
    if (lease && !heartbeatPending) {
      heartbeatPending = true;
      void submissionDomain
        .heartbeatJudgeStage(lease.executionId, lease.workflowId, lease.runId)
        .then((owned) => {
          if (!owned) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          heartbeatPending = false;
        });
    }
  }, 15_000);
  try {
    return await run(signal);
  } finally {
    clearInterval(timer);
  }
}

async function sandboxPlan(
  request: SandboxRequest | undefined,
  pointer: StorageObjectPointer,
  studentId: string,
  createdAt: Date,
  language: Language,
) {
  const mode = request?.advanced ? "advanced" : (request?.judgeType ?? "standard");
  const memoryBytes = request
    ? parseResourceQuantity(
        resolveK8sMemoryLimit(request, {
          memoryLimit: "512Mi",
          headroomMb: Number(process.env.SANDBOX_MEMORY_HEADROOM_MB ?? 64),
          maxMemoryMb: Number(process.env.SANDBOX_MAX_MEMORY_MB ?? 1536),
        }),
      )
    : 512 * 1024 ** 2;
  const compilerMemoryBytes = Math.max(memoryBytes, 512 * 1024 ** 2);
  const config = new KubeConfig();
  config.loadFromCluster();
  const runtime = await config.makeApiClient(NodeV1Api).readRuntimeClass({ name: "gvisor" });
  const overhead = {
    cpuMillis: parseResourceQuantity(runtime.overhead?.podFixed?.cpu, true),
    memoryBytes: parseResourceQuantity(runtime.overhead?.podFixed?.memory),
  };
  const advanced = request?.advanced;
  const hasSidecar = advanced?.network.mode === "service";
  const resources =
    mode === "interactive"
      ? { cpuMillis: 2000, memoryBytes: memoryBytes * 2 }
      : mode === "advanced"
        ? {
            cpuMillis: hasSidecar ? 3000 : 2000,
            memoryBytes:
              (advanced?.memoryMb ?? 512) * 1024 ** 2 * (hasSidecar ? 2 : 1) + 512 * 1024 ** 2,
          }
        : { cpuMillis: 1000, memoryBytes };
  recordJudgePhase("queue", Date.now() - createdAt.getTime(), mode, language);
  return {
    pointer,
    studentId: studentId,
    mode,
    terminal: false,
    caseIndices: request?.testcases.map((tc) => tc.index) ?? [],
    resources,
    compilerResources: { cpuMillis: 1000, memoryBytes: compilerMemoryBytes },
    overhead: {
      cpuMillis: overhead.cpuMillis * (hasSidecar ? 2 : 1),
      memoryBytes: overhead.memoryBytes * (hasSidecar ? 2 : 1),
    },
  };
}

export async function prepareSandboxAttempt(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string,
  lease?: CapacityLease,
) {
  const data = await dataFor(pointer);
  return running(
    (signal) => executor(nodeName).prepareAttempt(data.request, { runId, signal }),
    lease,
  );
}

export async function executeSandboxWave(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string,
  indices: number[],
  artifact?: PreparedArtifactReference,
  lease?: CapacityLease,
) {
  const data = await dataFor(pointer);
  const result = await running(
    (signal) =>
      artifact
        ? executor(nodeName).executePreparedWave(
            data.request,
            { runId, signal },
            artifact,
            indices,
          )
        : executor(nodeName).execute(
            {
              ...data.request,
              testcases: data.request.testcases.filter((tc) => indices.includes(tc.index)),
            },
            { runId, signal },
          ),
    lease,
  );
  return write(runId, `wave-${String(indices[0] ?? "advanced")}`, result);
}

export async function cleanupSandboxStage(runId: string) {
  await executor().cleanupRun(runId, true);
}
export async function cleanupSandboxAttempt(runId: string) {
  await executor().cleanupRun(runId);
  const client = createStorageClient();
  try {
    await deleteBlobsByPrefix(client, prefix(runId));
  } finally {
    client.destroy();
  }
}
export async function recordAdmissionWait(
  pointer: StorageObjectPointer,
  durationMs: number,
  phase: JudgePhase = "admission",
) {
  const data = await dataFor(pointer);
  recordJudgePhase(
    phase,
    durationMs,
    data.useAdvanced ? "advanced" : data.request.judgeType,
    data.request.language,
  );
}

export async function initializePinnedSandboxAttempt(
  executionId: string,
  workflowId: string,
  runId: string,
) {
  const { execution, snapshot } = await submissionDomain.loadJudgeExecution(executionId);
  if (
    execution.workflowId !== workflowId ||
    ["completed", "cancelled"].includes(execution.state)
  )
    return { obsolete: true as const };
  const request = buildPinnedSandboxRequest(snapshot);
  const pointer = await write(runId, "input", {
    request,
    useAdvanced: Boolean(request.advanced),
    executionId,
    workflowId,
  });
  const meta = await submissionDomain.getJudgeDispatchMeta(snapshot.submissionId);
  const plan = await sandboxPlan(
    request,
    pointer,
    meta.userId,
    execution.createdAt,
    snapshot.draft.language,
  );
  const checkpoints = await submissionDomain.readJudgeStages(executionId);
  const completed = checkpoints.flatMap(
    (result) =>
      result.rawRuns?.map((run) => run.index) ??
      result.testcaseResults.map((result) => result.index),
  );
  if (new Set(completed).size !== completed.length)
    throw new Error("Duplicate pinned testcase checkpoints");
  return {
    ...plan,
    obsolete: false as const,
    submittedAt: execution.createdAt.getTime(),
    checkpointCount: checkpoints.length,
    completedIndices: completed,
    priorLease: execution.leaseToken,
  };
}

export async function claimPinnedCapacityAttempt(
  executionId: string,
  workflowId: string,
  runId: string,
) {
  return submissionDomain.claimCapacityAttempt(
    executionId,
    workflowId,
    runId,
    process.env.HOSTNAME ?? hostname(),
  );
}
export async function judgeExecutionTurn(executionId: string, workflowId: string) {
  const turn = await submissionDomain.judgeExecutionTurn(executionId, workflowId);
  if (turn === "obsolete") return turn;
  const { getTemporalClient } = await import("@nojv/temporal");
  const client = await getTemporalClient();
  const state = await client.workflow.getHandle("judge-admission-v1").query<{
    dispatchRoute: string;
    draining: boolean;
    activeSubmissionIds: string[];
  }>("admissionState");
  if (
    state.draining &&
    state.dispatchRoute === "legacy" &&
    !state.activeSubmissionIds.includes(executionId)
  )
    return "redirect" as const;
  return turn;
}
export const heartbeatPinnedCapacityAttempt = submissionDomain.heartbeatJudgeStage;
export const releasePinnedCapacityAttempt = submissionDomain.releaseJudgeStage;
export const relinquishPinnedCapacityStrategy = submissionDomain.relinquishCapacityStrategy;

function assertInfrastructureSuccess(result: SandboxResult) {
  if (
    result.pipelineError ||
    result.overallVerdict === "SE" ||
    result.testcaseResults.some((item) => item.verdict === "SE") ||
    result.rawRuns?.some((item) => item.errorVerdict === "SE")
  )
    throw ApplicationFailure.nonRetryable(
      result.pipelineError ?? "Pinned sandbox returned a platform error",
      "JudgeResultSystemError",
    );
}

export async function executePinnedSandboxWave(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string,
  indices: number[],
  checkpoint: number,
  lease: CapacityLease,
  artifact?: PreparedArtifactReference,
) {
  const resultPointer = await executeSandboxWave(
    pointer,
    runId,
    nodeName,
    indices,
    artifact,
    lease,
  );
  const result = await read<SandboxResult>(resultPointer);
  assertInfrastructureSuccess(result);
  await submissionDomain.saveJudgeStage(
    lease.executionId,
    lease.workflowId,
    checkpoint,
    result,
    runId,
    false,
    true,
  );
}

export async function finishPinnedSandboxAttempt(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string | undefined,
  lease: CapacityLease,
  compilationError?: string,
) {
  const { request } = await read<{ request: SandboxRequest }>(pointer);
  const checkpoints = await submissionDomain.readJudgeStages(lease.executionId);
  let result: SandboxResult = { testcaseResults: [] };
  if (compilationError !== undefined) result.compilationError = compilationError;
  else if (!request.advanced && request.judgeType !== "interactive") {
    const rawRuns = checkpoints.flatMap((entry) => entry.rawRuns ?? []);
    const rawIndices = new Set(rawRuns.map((entry) => entry.index));
    const alreadyGraded = checkpoints.flatMap((entry) =>
      entry.testcaseResults.map((entry) => entry.index),
    );
    const allIndices = [...rawIndices, ...alreadyGraded];
    if (
      rawIndices.size !== rawRuns.length ||
      allIndices.length !== request.testcases.length ||
      new Set(allIndices).size !== allIndices.length ||
      request.testcases.some((testcase) => !allIndices.includes(testcase.index))
    )
      throw new Error("Pinned testcase checkpoints are incomplete or duplicated");
    result = await running(
      (signal) =>
        executor(nodeName).finishPreparedAttempt(
          {
            ...request,
            testcases: request.testcases.filter((testcase) => rawIndices.has(testcase.index)),
          },
          { runId, signal },
          rawRuns,
        ),
      lease,
    );
    delete result.rawRuns;
  }
  assertInfrastructureSuccess(result);
  await submissionDomain.saveJudgeStage(
    lease.executionId,
    lease.workflowId,
    checkpoints.length,
    result,
    runId,
    true,
    true,
  );
}
