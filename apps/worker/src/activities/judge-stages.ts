import { cancellationSignal, heartbeat } from "@temporalio/activity";
import { KubeConfig, NodeV1Api } from "@kubernetes/client-node";
import {
  createStorageClient,
  putImmutableText,
  getVerifiedText,
  deleteBlobsByPrefix,
  type StorageObjectPointer,
} from "@nojv/storage";
import { submissionDomain } from "@nojv/application";
import type { RawCaseRun, SandboxResult, SubmissionJudgeDraft } from "@nojv/core";
import {
  K8sExecutor,
  resolveK8sMemoryLimit,
  type PreparedArtifactReference,
} from "../services/k8s-executor";
import { parseResourceQuantity } from "../services/judge-capacity";
import { parseWorkerEnv } from "../env";
import { loadSandboxExecution, mapSandboxExecution, type SandboxExecutionData } from "./judge";
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
    maxParallelCases: 4,
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
async function dataFor(pointer: StorageObjectPointer): Promise<SandboxExecutionData> {
  const data = await read<SandboxExecutionData>(pointer);
  if (data.judgeContext) {
    const adjustment = data.judgeContext.adjustment;
    adjustment.submittedAt = new Date(adjustment.submittedAt);
    if (adjustment.dueAt) adjustment.dueAt = new Date(adjustment.dueAt);
  }
  return data;
}
async function running<T>(run: () => Promise<T>): Promise<T> {
  heartbeat("stage-started");
  const timer = setInterval(() => heartbeat("stage-running"), 15_000);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}

export async function initializeSandboxAttempt(
  submissionId: string,
  draft: SubmissionJudgeDraft,
  runId: string,
) {
  const data = await loadSandboxExecution(submissionId, draft);
  const pointer = await write(runId, "input", data);
  const meta = await submissionDomain.getJudgeDispatchMeta(submissionId);
  const mode = data.request?.advanced ? "advanced" : (data.request?.judgeType ?? "standard");
  const memoryBytes = data.request
    ? parseResourceQuantity(
        resolveK8sMemoryLimit(data.request, {
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
  const advanced = data.request?.advanced;
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
  recordJudgePhase("queue", Date.now() - meta.createdAt.getTime(), mode, draft.language);
  return {
    pointer,
    studentId: meta.userId,
    mode,
    terminal: data.result !== undefined,
    caseIndices: data.request?.testcases.map((tc) => tc.index) ?? [],
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
) {
  const data = await dataFor(pointer);
  if (!data.request) throw new Error("Missing sandbox request");
  return running(() =>
    executor(nodeName).prepareAttempt(data.request, { runId, signal: cancellationSignal() }),
  );
}

export async function executeSandboxWave(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string,
  indices: number[],
  artifact?: PreparedArtifactReference,
) {
  const data = await dataFor(pointer);
  if (!data.request) throw new Error("Missing sandbox request");
  const result = await running(() =>
    artifact
      ? executor(nodeName).executePreparedWave(
          data.request,
          { runId, signal: cancellationSignal() },
          artifact,
          indices,
        )
      : executor(nodeName).execute(
          {
            ...data.request,
            testcases: data.request.testcases.filter((tc) => indices.includes(tc.index)),
          },
          { runId, signal: cancellationSignal() },
        ),
  );
  return write(runId, `wave-${String(indices[0] ?? "advanced")}`, result);
}

export async function finishSandboxAttempt(
  pointer: StorageObjectPointer,
  runId: string,
  nodeName: string | undefined,
  results: StorageObjectPointer[],
  compilationError?: string,
) {
  const data = await dataFor(pointer);
  if (data.result !== undefined)
    return {
      result: data.result,
      advancedJudgeVerificationSnapshot: data.advancedJudgeVerificationSnapshot,
    };
  let result: SandboxResult;
  if (compilationError !== undefined) result = { testcaseResults: [], compilationError };
  else {
    const waves = await Promise.all(results.map((ref) => read<SandboxResult>(ref)));
    if (data.useAdvanced) result = waves[0] ?? { testcaseResults: [] };
    else if (data.request.judgeType === "interactive")
      result = { testcaseResults: waves.flatMap((wave) => wave.testcaseResults) };
    else {
      const rawRuns: RawCaseRun[] = waves.flatMap((wave) => wave.rawRuns ?? []);
      const expected = data.request.testcases.map((tc) => tc.index);
      if (
        rawRuns.length !== expected.length ||
        new Set(rawRuns.map((run) => run.index)).size !== expected.length ||
        rawRuns.some((run) => !expected.includes(run.index))
      )
        throw new Error("Missing or duplicate testcase results");
      result = await running(() =>
        executor(nodeName).finishPreparedAttempt(
          data.request,
          { runId, signal: cancellationSignal() },
          rawRuns,
        ),
      );
    }
  }
  return mapSandboxExecution(data, result);
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
  if (data.request)
    recordJudgePhase(
      phase,
      durationMs,
      data.useAdvanced ? "advanced" : data.request.judgeType,
      data.request.language,
    );
}
