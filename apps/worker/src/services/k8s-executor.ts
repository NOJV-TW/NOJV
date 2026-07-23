import { createRequire } from "node:module";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
  DEFAULT_MAX_MEMORY_MB,
  DEFAULT_MEMORY_HEADROOM_MB,
  resolveContainerMemoryMb,
  type RawCaseRun,
  type SandboxExecutionContext,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";
import { createLogger } from "../logger.js";
import { mergeInteractiveCase, type InteractiveSideResult } from "./check-interactive";
import { mergeCheckerResults, resolveSandboxResult } from "./check-standard";
import { executionAbortReason } from "./execution-abort";
import { advancedFallbackResult, mapAdvancedResult } from "./sandbox-result-mapper";
import { parseSandboxResult, parseValidateOutput } from "./sandbox-schema";
import { sandboxSystemError } from "./sandbox-plan";
import {
  buildRunConfigMapData,
  buildInteractiveInteractorConfigMapData,
  buildInteractiveSolutionConfigMapData,
  buildValidateConfigMapData,
  computeJobDeadlineSeconds,
  CONFIGMAP_MAX_BYTES,
  JOB_DEADLINE_FLOOR_SECONDS,
} from "./k8s-configmaps";
import {
  buildInteractiveJobManifest,
  buildPerCaseSandboxJobManifest,
  buildSandboxJobManifest,
  COMPILE_CONTAINER_NAME,
  perCaseContainerName,
} from "./k8s-job-manifests";
import { buildPayloadConfigMaps, payloadConfigMapNames } from "./k8s-payload";
import { scanJsonLinesFromEnd } from "./k8s-log-parse";
import {
  ADVANCED_SIDECAR_NAME,
  ADVANCED_TRANSFER_NAME,
  advancedPvcName,
  buildAdvancedConfigMapData,
  buildAdvancedGradeConfigMapData,
  buildAdvancedGradeJobManifest,
  buildAdvancedPvcManifest,
  buildAdvancedRunJobManifest,
  deriveRunStatusFromJob,
  parseAdvancedResultLog,
} from "./k8s-advanced";
import {
  buildGradeEgressPolicy,
  buildRunEgressPolicy,
  buildServiceRunEnv,
  buildServiceSidecarPodManifest,
  buildSidecarNetworkPolicy,
  buildSidecarServiceManifest,
  gradeEgressLabel,
  gradePolicyName,
  runEgressLabel,
  runPolicyName,
  SERVICE_READY_MARKER,
  sidecarPodName,
  sidecarPolicyName,
  sidecarServiceName,
  SIDECAR_PORT,
} from "./k8s-advanced-network";

const logger = createLogger("k8s-executor");

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  headroomMb?: number;
  maxMemoryMb?: number;
  imagePullSecretName?: string;
  sidecarReadinessTimeoutMs?: number;
  sidecarReadinessIntervalMs?: number;
  maxParallelCases?: number;
}

function parseMemoryLimitMb(value: string): number {
  return Number.parseInt(value, 10);
}

export function resolveK8sMemoryLimit(
  request: SandboxRequest,
  config: Pick<K8sExecutorConfig, "memoryLimit" | "headroomMb" | "maxMemoryMb">,
): string {
  const memoryMb = resolveContainerMemoryMb(request.limits.memoryMb, {
    defaultMemoryMb: parseMemoryLimitMb(config.memoryLimit),
    headroomMb: config.headroomMb ?? DEFAULT_MEMORY_HEADROOM_MB,
    maxMemoryMb: config.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
  });
  return `${String(memoryMb)}Mi`;
}

const SIDECAR_READINESS_TIMEOUT_MS = 30_000;
const SIDECAR_READINESS_INTERVAL_MS = 500;

const JOB_DEADLINE_BUFFER_SECONDS = 60;
const JOB_POLL_INTERVAL_MS = 1_000;
const POD_SCHEDULE_GRACE_MS = 30_000;
const POD_CLEANUP_TIMEOUT_MS = 30_000;
const POD_CLEANUP_POLL_INTERVAL_MS = 250;
const K8S_CLEANUP_CALL_TIMEOUT_MS = 5_000;
const K8S_CLEANUP_ATTEMPTS = 3;
const K8S_CLEANUP_RETRY_DELAY_MS = 100;

const DEFAULT_MAX_PARALLEL_CASES = 4;

function k8sErrorCode(reason: unknown): number | null {
  if (reason instanceof Error && reason.cause !== undefined) {
    const causeCode = k8sErrorCode(reason.cause);
    if (causeCode !== null) return causeCode;
  }
  if (typeof reason !== "object" || reason === null || !("code" in reason)) return null;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function isTransientK8sError(reason: unknown): boolean {
  const code = k8sErrorCode(reason);
  return (
    code === null || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500
  );
}

function boundedK8sCall<T>(operation: Promise<T>, resource: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(
      () =>
        settle(() =>
          reject(
            new Error(
              `Kubernetes cleanup call timed out for ${resource} after ${String(K8S_CLEANUP_CALL_TIMEOUT_MS)}ms.`,
            ),
          ),
        ),
      K8S_CLEANUP_CALL_TIMEOUT_MS,
    );
    void operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) =>
        settle(() =>
          reject(
            error instanceof Error
              ? error
              : new Error(`Kubernetes cleanup call failed for ${resource}.`, { cause: error }),
          ),
        ),
    );
  });
}

async function retryK8sCleanupCall<T>(
  resource: string,
  operation: () => Promise<T>,
  options: { notFoundIsSuccess?: boolean } = {},
): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= K8S_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      return await boundedK8sCall(operation(), resource);
    } catch (error) {
      if (options.notFoundIsSuccess === true && k8sErrorCode(error) === 404) return null;
      lastError = error;
      if (!isTransientK8sError(error) || attempt === K8S_CLEANUP_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, K8S_CLEANUP_RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error(
    `Kubernetes cleanup failed for ${resource} after ${String(K8S_CLEANUP_ATTEMPTS)} attempts: ${failureMessage(lastError)}`,
  );
}

function failureMessage(reason: unknown): string {
  if (reason instanceof Error) {
    const cause = reason.cause;
    return cause === undefined
      ? reason.message
      : `${reason.message} Caused by: ${failureMessage(cause)}`;
  }
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof reason === "string") return reason;
  if (reason === undefined) return "undefined";
  if (typeof reason === "number" || typeof reason === "boolean") return String(reason);
  if (typeof reason === "bigint") return reason.toString();
  if (typeof reason === "function") return `function ${reason.name || "anonymous"}`;
  if (typeof reason === "symbol") return reason.description ?? "symbol";
  try {
    return JSON.stringify(reason);
  } catch {
    return "unserializable failure";
  }
}

function throwCleanupFailures(label: string, results: PromiseSettledResult<unknown>[]): void {
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => failureMessage(result.reason));
  if (failures.length > 0) {
    throw new Error(`${label} cleanup failed: ${failures.join(" | ")}`);
  }
}

function combineExecutionAndCleanupFailure(
  executionFailure: unknown,
  cleanupFailure: unknown,
): Error {
  const cleanup = failureMessage(cleanupFailure);
  if (!(executionFailure instanceof Error)) {
    return new Error(
      `Sandbox execution failed: ${failureMessage(executionFailure)} Cleanup also failed: ${cleanup}`,
    );
  }
  Object.defineProperty(executionFailure, "message", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: `${executionFailure.message} Cleanup also failed: ${cleanup}`,
  });
  return executionFailure;
}

async function runCleanupAfterExecution(
  executionFailure: { reason: unknown } | undefined,
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (cleanupFailure) {
    if (executionFailure !== undefined) {
      throw combineExecutionAndCleanupFailure(executionFailure.reason, cleanupFailure);
    }
    throw cleanupFailure;
  }
}

async function runCleanupOperations(
  label: string,
  operations: Promise<unknown>[],
): Promise<void> {
  const results = await Promise.allSettled(operations);
  throwCleanupFailures(label, results);
}

export function chunkCaseIndices(indices: number[], size: number): number[][] {
  const chunkSize = Math.max(1, size);
  const chunks: number[][] = [];
  for (let i = 0; i < indices.length; i += chunkSize) {
    chunks.push(indices.slice(i, i + chunkSize));
  }
  return chunks;
}

function resolveMaxParallelCases(config: Pick<K8sExecutorConfig, "maxParallelCases">): number {
  if (config.maxParallelCases !== undefined && config.maxParallelCases > 0) {
    return config.maxParallelCases;
  }
  const fromEnv = Number.parseInt(process.env.SANDBOX_MAX_PARALLEL_CASES ?? "", 10);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_PARALLEL_CASES;
}

export class SandboxBackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxBackpressureError";
  }
}

export class SandboxImagePullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxImagePullError";
  }
}

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
  networkingApi?: k8s.NetworkingV1Api;
}

function validatorOutcomesSeForAll(rawRuns: RawCaseRun[]): Map<number, ValidatorOutcome> {
  return new Map(
    rawRuns
      .filter((r) => !r.errorVerdict)
      .map((r): [number, ValidatorOutcome] => [r.index, { verdict: "SE" }]),
  );
}

function parseValidatorOutcomesFromLogs(
  logs: string,
  rawRuns: RawCaseRun[],
): Map<number, ValidatorOutcome> | null {
  return scanJsonLinesFromEnd(logs, (json) => {
    const parsed = parseValidateOutput(json);
    if (!parsed.success || parsed.data.validatorOutcomes === undefined) return null;

    const outcomes = new Map<number, ValidatorOutcome>();
    for (const o of parsed.data.validatorOutcomes) {
      const { index, ...rest } = o;
      outcomes.set(index, rest);
    }
    for (const r of rawRuns) {
      if (!r.errorVerdict && !outcomes.has(r.index)) {
        outcomes.set(r.index, { verdict: "SE" });
      }
    }
    return outcomes;
  });
}

function parseCompilationError(logs: string): string | null {
  return (
    scanJsonLinesFromEnd(logs, (json) => {
      const { compilationError } = json as { compilationError?: unknown };
      return { value: typeof compilationError === "string" ? compilationError : null };
    })?.value ?? null
  );
}

export class K8sExecutor implements SandboxExecutor {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batchApi: k8s.BatchV1Api;
  private networkingApiHandle: k8s.NetworkingV1Api | undefined;

  constructor(
    private readonly config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      this.networkingApiHandle = clients.networkingApi;
      return;
    }
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
    this.networkingApiHandle = kc.makeApiClient(k8sLib.NetworkingV1Api);
  }

  private networkingApi(): k8s.NetworkingV1Api {
    if (!this.networkingApiHandle) {
      throw new Error("NetworkingV1Api client is not available");
    }
    return this.networkingApiHandle;
  }

  async execute(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    execution.signal.throwIfAborted();
    try {
      if (request.advanced) {
        return await this.executeAdvanced(request, execution);
      }

      if (request.judgeType === "interactive") {
        return await this.executeInteractive(request, execution);
      }

      if (request.judgeType === "checker") {
        return await this.executeChecker(request, execution);
      }

      return await this.executeRunOnly(request, execution);
    } catch (err) {
      execution.signal.throwIfAborted();
      if (err instanceof SandboxImagePullError) {
        return { ...sandboxSystemError(err.message), scoringFeedback: err.message };
      }
      throw err;
    }
  }

  private async executeAdvanced(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    const advanced = request.advanced;
    if (!advanced) return sandboxSystemError("advanced-mode dispatch called without payload");

    const resourceId = execution.runId;
    const baseName = `judge-${resourceId}`;
    const ns = this.config.namespace;
    const runJobName = `${baseName}-run`;
    const gradeJobName = `${baseName}-grade`;
    const runConfigMapName = `${runJobName}-input`;
    const gradeConfigMapName = `${gradeJobName}-input`;
    const pvcName = advancedPvcName(resourceId);
    const deadlineSeconds = Math.ceil(advanced.totalTimeMs / 1000) + 30;
    const mode = advanced.network.mode;
    const hasSidecar = mode === "service";
    let executionFailure: { reason: unknown } | undefined;

    try {
      await this.createPvc(pvcName, ns, execution.signal);
      await this.createConfigMap(
        runConfigMapName,
        ns,
        buildAdvancedConfigMapData(request),
        execution.signal,
      );

      let runExtraEnv: Record<string, string> | undefined;
      try {
        runExtraEnv = await this.prepareAdvancedNetwork(
          resourceId,
          advanced,
          mode,
          ns,
          execution.signal,
        );
      } catch (err) {
        execution.signal.throwIfAborted();
        return advancedFallbackResult(
          request,
          `Advanced network setup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      await this.createNamespacedNetworkPolicy(
        ns,
        buildGradeEgressPolicy({ submissionId: resourceId, namespace: ns }),
        execution.signal,
      );

      await this.batchApi.createNamespacedJob({
        namespace: ns,
        body: buildAdvancedRunJobManifest({
          jobName: runJobName,
          namespace: ns,
          configMapName: runConfigMapName,
          pvcName,
          sandboxImage: this.config.image,
          runImage: advanced.run.imageRef,
          memoryMb: advanced.memoryMb,
          totalTimeMs: advanced.totalTimeMs,
          cpuLimit: this.config.cpuLimit,
          submissionId: resourceId,
          language: request.language,
          ...(hasSidecar ? { egressLabel: runEgressLabel(resourceId) } : {}),
          ...(runExtraEnv ? { extraEnv: runExtraEnv } : {}),
          ...(this.config.imagePullSecretName
            ? { imagePullSecretName: this.config.imagePullSecretName }
            : {}),
        }),
      });
      execution.signal.throwIfAborted();

      const runOutcome = await this.waitForJobOutcome(
        runJobName,
        ns,
        deadlineSeconds,
        execution.signal,
      );
      const { nodeName, transferCaptureOk } = await this.inspectRunPod(
        runJobName,
        ns,
        execution.signal,
      );
      if (!nodeName) {
        return advancedFallbackResult(request, "Advanced run phase produced no scheduled pod.");
      }
      if (!runOutcome.deadlineExceeded && !transferCaptureOk) {
        return advancedFallbackResult(
          request,
          "Advanced run output capture failed (size/file cap or IO error).",
        );
      }

      const runStatus = deriveRunStatusFromJob(runOutcome.state, runOutcome.deadlineExceeded);

      await this.createConfigMap(
        gradeConfigMapName,
        ns,
        buildAdvancedGradeConfigMapData(
          request.submissionId,
          request.language,
          runStatus,
          advanced.maxScore,
        ),
        execution.signal,
      );
      await this.batchApi.createNamespacedJob({
        namespace: ns,
        body: buildAdvancedGradeJobManifest({
          jobName: gradeJobName,
          namespace: ns,
          configMapName: gradeConfigMapName,
          pvcName,
          sandboxImage: this.config.image,
          gradeImage: advanced.grade.imageRef,
          memoryMb: advanced.memoryMb,
          totalTimeMs: advanced.totalTimeMs,
          cpuLimit: this.config.cpuLimit,
          submissionId: resourceId,
          language: request.language,
          nodeName,
          egressLabel: gradeEgressLabel(resourceId),
          ...(this.config.imagePullSecretName
            ? { imagePullSecretName: this.config.imagePullSecretName }
            : {}),
        }),
      });
      execution.signal.throwIfAborted();

      await this.waitForJobCompletion(gradeJobName, ns, deadlineSeconds, execution.signal);
      const gradePodName = await this.findPodName(gradeJobName, ns, execution.signal);
      if (!gradePodName) {
        return advancedFallbackResult(request, "Advanced grade phase produced no pod.");
      }

      const sidecarLog = await this.coreApi
        .readNamespacedPodLog({
          name: gradePodName,
          namespace: ns,
          container: ADVANCED_SIDECAR_NAME,
        })
        .catch(() => "");
      execution.signal.throwIfAborted();

      const raw = parseAdvancedResultLog(sidecarLog);
      if (raw === null) {
        return advancedFallbackResult(
          request,
          "Advanced sandbox sidecar produced no result marker.",
        );
      }

      if (raw && typeof raw === "object" && (raw as { missing?: boolean }).missing === true) {
        return advancedFallbackResult(
          request,
          "Advanced judge image did not write result.json before the deadline.",
        );
      }

      const parsed = advancedResultSchema.safeParse(raw);
      if (!parsed.success) {
        return advancedFallbackResult(
          request,
          `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        );
      }
      const resultIssues = validateAdvancedResultForMaxScore(parsed.data, advanced.maxScore);
      if (resultIssues.length > 0) {
        return advancedFallbackResult(
          request,
          `Invalid result.json: ${resultIssues.join(", ")}`,
        );
      }

      return mapAdvancedResult(request, parsed.data);
    } catch (err) {
      if (execution.signal.aborted) {
        const reason = executionAbortReason(execution.signal);
        executionFailure = { reason };
        throw reason;
      }
      executionFailure = { reason: err };
      logger.error("K8s advanced execution failed", {
        submissionId: request.submissionId,
        baseName,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      await runCleanupAfterExecution(executionFailure, async () => {
        const jobCleanup = await Promise.allSettled([
          this.cleanupAdvancedJob(runJobName, ns),
          this.cleanupAdvancedJob(gradeJobName, ns),
        ]);
        const runPodsGone = jobCleanup[0].status === "fulfilled";
        const gradePodsGone = jobCleanup[1].status === "fulfilled";
        const privateDataCleanup = await Promise.allSettled([
          this.cleanupConfigMap(runConfigMapName, ns),
          this.cleanupConfigMap(gradeConfigMapName, ns),
          this.cleanupPvc(pvcName, ns),
          this.teardownAdvancedNetwork(resourceId, ns, hasSidecar, {
            runPodsGone,
            gradePodsGone,
          }),
        ]);
        throwCleanupFailures("advanced sandbox", [...jobCleanup, ...privateDataCleanup]);
      });
    }
  }

  private async prepareAdvancedNetwork(
    resourceId: string,
    advanced: NonNullable<SandboxRequest["advanced"]>,
    mode: "none" | "service",
    ns: string,
    signal: AbortSignal,
  ): Promise<Record<string, string> | undefined> {
    if (mode === "none") return undefined;

    const service = advanced.network.service;
    if (!service) {
      throw new Error("service network mode selected without a service image");
    }
    await this.coreApi.createNamespacedPod({
      namespace: ns,
      body: buildServiceSidecarPodManifest({
        submissionId: resourceId,
        namespace: ns,
        image: service.imageRef,
        memoryMb: advanced.memoryMb,
        cpuLimit: this.config.cpuLimit,
        port: SIDECAR_PORT,
        ...(this.config.imagePullSecretName
          ? { imagePullSecretName: this.config.imagePullSecretName }
          : {}),
      }),
    });
    signal.throwIfAborted();
    const clusterIp = await this.createSidecarServiceAndPolicies(resourceId, ns, signal);

    const ready = await this.waitForSidecarMarker(resourceId, ns, SERVICE_READY_MARKER, signal);
    if (!ready) {
      throw new Error("service sidecar did not become ready within timeout");
    }
    return buildServiceRunEnv(clusterIp);
  }

  private async createSidecarServiceAndPolicies(
    submissionId: string,
    ns: string,
    signal: AbortSignal,
  ): Promise<string> {
    const created = await this.coreApi.createNamespacedService({
      namespace: ns,
      body: buildSidecarServiceManifest({ submissionId, namespace: ns, port: SIDECAR_PORT }),
    });
    signal.throwIfAborted();
    const clusterIp = created.spec?.clusterIP;
    if (!clusterIp || clusterIp === "None") {
      throw new Error("sidecar Service was created without an assigned ClusterIP");
    }
    await this.createNamespacedNetworkPolicy(
      ns,
      buildSidecarNetworkPolicy({ submissionId, namespace: ns }),
      signal,
    );
    await this.createNamespacedNetworkPolicy(
      ns,
      buildRunEgressPolicy({ submissionId, namespace: ns }),
      signal,
    );
    return clusterIp;
  }

  private async waitForSidecarMarker(
    submissionId: string,
    ns: string,
    marker: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const podName = sidecarPodName(submissionId);
    const timeoutMs = this.config.sidecarReadinessTimeoutMs ?? SIDECAR_READINESS_TIMEOUT_MS;
    const intervalMs = this.config.sidecarReadinessIntervalMs ?? SIDECAR_READINESS_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const log = await this.coreApi
        .readNamespacedPodLog({ name: podName, namespace: ns })
        .catch(() => "");
      signal.throwIfAborted();
      if (log.includes(marker)) return true;
      await this.sleep(intervalMs, signal);
    }
    return false;
  }

  private async createNamespacedNetworkPolicy(
    ns: string,
    body: k8s.V1NetworkPolicy,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.networkingApi().createNamespacedNetworkPolicy({ namespace: ns, body });
    signal.throwIfAborted();
  }

  private async teardownAdvancedNetwork(
    submissionId: string,
    ns: string,
    hasSidecar: boolean,
    podsGone: { runPodsGone: boolean; gradePodsGone: boolean },
  ): Promise<void> {
    const networkingApi = this.networkingApi();
    const deletePolicy = (name: string) =>
      retryK8sCleanupCall(
        `NetworkPolicy ${ns}/${name}`,
        () => networkingApi.deleteNamespacedNetworkPolicy({ name, namespace: ns }),
        { notFoundIsSuccess: true },
      );

    const cleanupResults: PromiseSettledResult<unknown>[] = [];
    let sidecarGone = false;
    if (hasSidecar) {
      const sidecarCleanup = await Promise.allSettled([
        retryK8sCleanupCall(
          `Service ${ns}/${sidecarServiceName(submissionId)}`,
          () =>
            this.coreApi.deleteNamespacedService({
              name: sidecarServiceName(submissionId),
              namespace: ns,
            }),
          { notFoundIsSuccess: true },
        ),
        this.cleanupAdvancedPod(sidecarPodName(submissionId), ns),
      ]);
      sidecarGone = sidecarCleanup[1].status === "fulfilled";
      cleanupResults.push(...sidecarCleanup);
    }

    const policyCleanup: Promise<unknown>[] = [];
    if (podsGone.gradePodsGone) {
      policyCleanup.push(deletePolicy(gradePolicyName(submissionId)));
    }
    if (hasSidecar && podsGone.runPodsGone) {
      policyCleanup.push(deletePolicy(runPolicyName(submissionId)));
    }
    if (sidecarGone) policyCleanup.push(deletePolicy(sidecarPolicyName(submissionId)));
    cleanupResults.push(...(await Promise.allSettled(policyCleanup)));
    throwCleanupFailures("advanced network", cleanupResults);
  }

  private async executeInteractive(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    if (!request.judgeConfig.interactorScript) {
      return sandboxSystemError("Interactive judge is missing its interactor script.");
    }

    const ns = this.config.namespace;
    const baseName = `judge-${execution.runId}`;
    const results: SandboxTestcaseResult[] = [];

    for (const testcase of request.testcases) {
      results.push(
        await this.runInteractiveCase(baseName, ns, request, testcase, execution.signal),
      );
    }

    return { testcaseResults: results };
  }

  private async runInteractiveCase(
    baseName: string,
    namespace: string,
    request: SandboxRequest,
    testcase: SandboxTestcase,
    signal: AbortSignal,
  ): Promise<SandboxTestcaseResult> {
    const jobName = `${baseName}-int-${String(testcase.index)}`;
    const solConfigMap = `${jobName}-sol`;
    const intConfigMap = `${jobName}-int`;
    let solutionPayloadNames: string[] = [];
    let interactorPayloadNames: string[] = [];
    let executionFailure: { reason: unknown } | undefined;

    const seCase = (message: string): SandboxTestcaseResult => ({
      index: testcase.index,
      verdict: "SE",
      stdout: "",
      stderr: message,
      exitCode: -1,
      timeMs: 0,
      feedback: message,
    });

    try {
      solutionPayloadNames = await this.createPayloadConfigMaps(
        solConfigMap,
        namespace,
        buildInteractiveSolutionConfigMapData(request),
        signal,
      );
      interactorPayloadNames = await this.createPayloadConfigMaps(
        intConfigMap,
        namespace,
        buildInteractiveInteractorConfigMapData(request, testcase),
        signal,
      );

      const deadlineSeconds = Math.max(
        Math.ceil(request.limits.timeoutMs / 1000) + 30,
        JOB_DEADLINE_FLOOR_SECONDS,
      );
      await this.batchApi.createNamespacedJob({
        namespace,
        body: buildInteractiveJobManifest({
          jobName,
          namespace,
          solutionConfigMapNames: solutionPayloadNames,
          interactorConfigMapNames: interactorPayloadNames,
          image: this.config.image,
          cpuRequest: this.config.cpuRequest,
          cpuLimit: this.config.cpuLimit,
          memoryRequest: this.config.memoryRequest,
          memoryLimit: resolveK8sMemoryLimit(request, this.config),
          activeDeadlineSeconds: deadlineSeconds,
        }),
      });
      signal.throwIfAborted();

      const outcome = await this.waitForJobOutcome(jobName, namespace, deadlineSeconds, signal);
      const podName = await this.findPodName(jobName, namespace, signal);
      if (!podName) {
        if (outcome.state === "failed") {
          return seCase("Interactive sandbox job failed or timed out.");
        }
        return seCase("Interactive sandbox produced no pod.");
      }

      const [solLogs, intLogs] = await Promise.all([
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "solution" })
          .catch(() => ""),
        this.coreApi
          .readNamespacedPodLog({ name: podName, namespace, container: "interactor" })
          .catch(() => ""),
      ]);
      signal.throwIfAborted();

      const sol: InteractiveSideResult = {
        stderr: solLogs,
        timedOut: outcome.deadlineExceeded,
        spawnError: false,
      };
      const int: InteractiveSideResult = {
        stderr: intLogs,
        timedOut: false,
        spawnError: false,
      };
      return mergeInteractiveCase(testcase, sol, int);
    } catch (err) {
      if (signal.aborted) {
        const reason = executionAbortReason(signal);
        executionFailure = { reason };
        throw reason;
      }
      if (err instanceof SandboxBackpressureError || err instanceof SandboxImagePullError) {
        executionFailure = { reason: err };
        throw err;
      }
      logger.error("K8s interactive case failed", {
        submissionId: request.submissionId,
        jobName,
        index: testcase.index,
        err: err instanceof Error ? err.message : String(err),
      });
      return seCase("Interactive sandbox failed to start.");
    } finally {
      await runCleanupAfterExecution(executionFailure, () =>
        runCleanupOperations("interactive sandbox", [
          this.cleanupJob(jobName, namespace),
          ...solutionPayloadNames.map((name) => this.cleanupConfigMap(name, namespace)),
          ...interactorPayloadNames.map((name) => this.cleanupConfigMap(name, namespace)),
        ]),
      );
    }
  }

  private async cleanupJob(name: string, namespace: string): Promise<void> {
    await retryK8sCleanupCall(
      `Job ${namespace}/${name}`,
      () =>
        this.batchApi.deleteNamespacedJob({
          name,
          namespace,
          propagationPolicy: "Background",
        }),
      { notFoundIsSuccess: true },
    );
  }

  private async cleanupAdvancedJob(name: string, namespace: string): Promise<boolean> {
    const deletion = await Promise.allSettled([
      retryK8sCleanupCall(
        `Job ${namespace}/${name}`,
        () =>
          this.batchApi.deleteNamespacedJob({
            name,
            namespace,
            propagationPolicy: "Foreground",
          }),
        { notFoundIsSuccess: true },
      ),
    ]);
    const podsGone = await Promise.allSettled([
      this.waitForPodsGone(namespace, { labelSelector: `job-name=${name}` }),
    ]);
    if (deletion[0].status === "fulfilled" && podsGone[0].status === "fulfilled") return true;
    throwCleanupFailures(`Job ${namespace}/${name}`, [...deletion, ...podsGone]);
    return false;
  }

  private async cleanupAdvancedPod(name: string, namespace: string): Promise<boolean> {
    const deletion = await Promise.allSettled([
      retryK8sCleanupCall(
        `Pod ${namespace}/${name}`,
        () =>
          this.coreApi.deleteNamespacedPod({
            name,
            namespace,
            propagationPolicy: "Foreground",
            gracePeriodSeconds: 0,
          }),
        { notFoundIsSuccess: true },
      ),
    ]);
    const podGone = await Promise.allSettled([
      this.waitForPodsGone(namespace, { fieldSelector: `metadata.name=${name}` }),
    ]);
    if (deletion[0].status === "fulfilled" && podGone[0].status === "fulfilled") return true;
    throwCleanupFailures(`Pod ${namespace}/${name}`, [...deletion, ...podGone]);
    return false;
  }

  private async waitForPodsGone(
    namespace: string,
    selector: { labelSelector?: string; fieldSelector?: string },
  ): Promise<boolean> {
    const deadline = Date.now() + POD_CLEANUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const pods = await retryK8sCleanupCall(`Pod list in ${namespace}`, () =>
        this.coreApi.listNamespacedPod({ namespace, ...selector }),
      );
      if (pods?.items.length === 0) return true;
      await new Promise((resolve) => setTimeout(resolve, POD_CLEANUP_POLL_INTERVAL_MS));
    }
    throw new Error(
      `Kubernetes cleanup timed out waiting for Pods in ${namespace} to terminate.`,
    );
  }

  private async findPodName(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    try {
      signal.throwIfAborted();
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
      return pods.items[0]?.metadata?.name ?? null;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  private async inspectRunPod(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<{ nodeName: string | null; transferCaptureOk: boolean }> {
    try {
      signal.throwIfAborted();
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
      const pod = pods.items[0];
      const nodeName = pod?.spec?.nodeName ?? null;
      const transferStatus = (pod?.status?.initContainerStatuses ?? []).find(
        (c) => c.name === ADVANCED_TRANSFER_NAME,
      );
      const transferCaptureOk = transferStatus?.state?.terminated?.exitCode === 0;
      return { nodeName, transferCaptureOk };
    } catch {
      signal.throwIfAborted();
      return { nodeName: null, transferCaptureOk: false };
    }
  }

  private async createPvc(name: string, namespace: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.coreApi.createNamespacedPersistentVolumeClaim({
      namespace,
      body: buildAdvancedPvcManifest({ pvcName: name, namespace }),
    });
    signal.throwIfAborted();
  }

  private async cleanupPvc(name: string, namespace: string): Promise<void> {
    await retryK8sCleanupCall(
      `PersistentVolumeClaim ${namespace}/${name}`,
      () => this.coreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace }),
      { notFoundIsSuccess: true },
    );
  }

  private async cleanupConfigMap(name: string, namespace: string): Promise<void> {
    await retryK8sCleanupCall(
      `ConfigMap ${namespace}/${name}`,
      () => this.coreApi.deleteNamespacedConfigMap({ name, namespace }),
      { notFoundIsSuccess: true },
    );
  }

  private async runPerCasePod(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    const ns = this.config.namespace;
    const allCaseIndices = request.testcases.map((tc) => tc.index);

    if (allCaseIndices.length === 0) return { testcaseResults: [] };

    const waves = chunkCaseIndices(allCaseIndices, resolveMaxParallelCases(this.config));
    const memoryLimit = resolveK8sMemoryLimit(request, this.config);
    const rawRuns: RawCaseRun[] = [];

    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const waveCaseIndices = waves[waveIndex] ?? [];
      const jobName =
        waves.length === 1
          ? `judge-${execution.runId}`
          : `judge-${execution.runId}-w${String(waveIndex)}`;
      const waveRequest: SandboxRequest = {
        ...request,
        testcases: request.testcases.filter((tc) => waveCaseIndices.includes(tc.index)),
      };
      const deadlineSeconds = computeJobDeadlineSeconds(waveRequest);
      let executionFailure: { reason: unknown } | undefined;
      let payloadNames: string[] = [];

      try {
        payloadNames = await this.createPayloadConfigMaps(
          jobName,
          ns,
          buildRunConfigMapData(waveRequest),
          execution.signal,
        );
        await this.createPerCaseJob(
          jobName,
          ns,
          payloadNames,
          deadlineSeconds,
          waveCaseIndices,
          memoryLimit,
          execution.signal,
        );

        await this.waitForJobCompletion(jobName, ns, deadlineSeconds, execution.signal);

        const compileLog = await this.getContainerLogs(
          jobName,
          ns,
          COMPILE_CONTAINER_NAME,
          execution.signal,
        );
        const compileError = parseCompilationError(compileLog);
        if (compileError) return { testcaseResults: [], compilationError: compileError };

        for (const index of waveCaseIndices) {
          const logs = await this.getContainerLogs(
            jobName,
            ns,
            perCaseContainerName(index),
            execution.signal,
          );
          const parsed = logs ? this.parseRunnerOutput(logs) : null;
          const run = parsed?.rawRuns?.[0];
          rawRuns.push(
            run ?? {
              index,
              stdout: "",
              stderr: parsed?.pipelineError ?? "Case container produced no result.",
              exitCode: -1,
              timeMs: 0,
              errorVerdict: "SE",
            },
          );
        }
      } catch (error) {
        executionFailure = { reason: error };
        throw error;
      } finally {
        await runCleanupAfterExecution(executionFailure, () =>
          this.cleanup(jobName, ns, payloadNames),
        );
      }
    }

    return { testcaseResults: [], rawRuns };
  }

  private async executeRunOnly(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    const result = await this.runPerCasePod(request, execution);
    return resolveSandboxResult(result, request.testcases, request.judgeConfig.compare);
  }

  private async executeChecker(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    const validateName = `judge-${execution.runId}-validate`;
    const ns = this.config.namespace;

    const runResult = await this.runPerCasePod(request, execution);
    if (!runResult.rawRuns) return runResult;
    const rawRuns = runResult.rawRuns;
    const hasGradableCase = rawRuns.some((r) => !r.errorVerdict);
    const outcomes = hasGradableCase
      ? await this.runValidateJob(validateName, ns, request, rawRuns, execution.signal)
      : new Map<number, ValidatorOutcome>();

    return { testcaseResults: mergeCheckerResults(rawRuns, outcomes) };
  }

  private async runValidateJob(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    rawRuns: RawCaseRun[],
    signal: AbortSignal,
  ): Promise<Map<number, ValidatorOutcome>> {
    let payloadNames: string[] = [];
    let executionFailure: { reason: unknown } | undefined;
    try {
      const deadlineSeconds = computeJobDeadlineSeconds(request);
      payloadNames = await this.createPayloadConfigMaps(
        jobName,
        namespace,
        buildValidateConfigMapData(request, rawRuns),
        signal,
      );
      await this.createJob(
        jobName,
        namespace,
        payloadNames,
        deadlineSeconds,
        resolveK8sMemoryLimit(request, this.config),
        signal,
      );

      const outcome = await this.waitForJobCompletion(
        jobName,
        namespace,
        deadlineSeconds,
        signal,
      );
      if (outcome === "failed") return validatorOutcomesSeForAll(rawRuns);

      const logs = await this.getPodLogs(jobName, namespace, signal);
      return (
        parseValidatorOutcomesFromLogs(logs, rawRuns) ?? validatorOutcomesSeForAll(rawRuns)
      );
    } catch (err) {
      if (signal.aborted) {
        const reason = executionAbortReason(signal);
        executionFailure = { reason };
        throw reason;
      }
      if (err instanceof SandboxBackpressureError || err instanceof SandboxImagePullError) {
        executionFailure = { reason: err };
        throw err;
      }
      logger.error("K8s validate Job failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return validatorOutcomesSeForAll(rawRuns);
    } finally {
      await runCleanupAfterExecution(executionFailure, () =>
        runCleanupOperations("checker validation sandbox", [
          this.cleanupJob(jobName, namespace),
          ...payloadNames.map((name) => this.cleanupConfigMap(name, namespace)),
        ]),
      );
    }
  }

  private async createPayloadConfigMaps(
    baseName: string,
    namespace: string,
    data: Record<string, string>,
    signal: AbortSignal,
  ): Promise<string[]> {
    const configMaps = buildPayloadConfigMaps(baseName, namespace, data);
    const names = payloadConfigMapNames(configMaps);
    const created: string[] = [];
    try {
      for (const configMap of configMaps) {
        signal.throwIfAborted();
        await this.coreApi.createNamespacedConfigMap({ namespace, body: configMap });
        const name = configMap.metadata?.name;
        if (!name) throw new Error("Created sandbox payload ConfigMap is missing a name.");
        created.push(name);
      }
      signal.throwIfAborted();
      return names;
    } catch (error) {
      const cleanup = await Promise.allSettled(
        created.map((name) => this.cleanupConfigMap(name, namespace)),
      );
      try {
        throwCleanupFailures("partial sandbox payload", cleanup);
      } catch (cleanupFailure) {
        throw combineExecutionAndCleanupFailure(error, cleanupFailure);
      }
      throw error;
    }
  }

  private async createConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const totalBytes = Object.entries(data).reduce(
      (sum, [key, value]) => sum + Buffer.byteLength(key) + Buffer.byteLength(value),
      0,
    );
    if (totalBytes > CONFIGMAP_MAX_BYTES) {
      throw new Error(
        `ConfigMap ${name} payload is ${String(totalBytes)} bytes, exceeding the ${String(CONFIGMAP_MAX_BYTES)}-byte limit; testcase data is too large for ConfigMap delivery.`,
      );
    }
    await this.coreApi.createNamespacedConfigMap({
      namespace,
      body: {
        metadata: { name, namespace },
        data,
      },
    });
    signal.throwIfAborted();
  }

  private async createJob(
    jobName: string,
    namespace: string,
    configMapNames: string[],
    deadlineSeconds: number,
    memoryLimit: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.batchApi.createNamespacedJob({
      namespace,
      body: buildSandboxJobManifest({
        jobName,
        namespace,
        configMapNames,
        image: this.config.image,
        cpuRequest: this.config.cpuRequest,
        cpuLimit: this.config.cpuLimit,
        memoryRequest: this.config.memoryRequest,
        memoryLimit,
        activeDeadlineSeconds: deadlineSeconds,
      }),
    });
    signal.throwIfAborted();
  }

  private async createPerCaseJob(
    jobName: string,
    namespace: string,
    configMapNames: string[],
    deadlineSeconds: number,
    caseIndices: number[],
    memoryLimit: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.batchApi.createNamespacedJob({
      namespace,
      body: buildPerCaseSandboxJobManifest({
        jobName,
        namespace,
        configMapNames,
        image: this.config.image,
        cpuRequest: this.config.cpuRequest,
        cpuLimit: this.config.cpuLimit,
        memoryRequest: this.config.memoryRequest,
        memoryLimit,
        activeDeadlineSeconds: deadlineSeconds,
        caseIndices,
      }),
    });
    signal.throwIfAborted();
  }

  private async waitForJobCompletion(
    jobName: string,
    namespace: string,
    deadlineSeconds: number,
    signal: AbortSignal,
  ): Promise<"succeeded" | "failed"> {
    return (await this.waitForJobOutcome(jobName, namespace, deadlineSeconds, signal)).state;
  }

  private jobBlockedReason(job: k8s.V1Job): string | null {
    const condition = (job.status?.conditions ?? []).find(
      (c) =>
        c.status === "True" &&
        (c.reason === "FailedCreate" ||
          /exceeded quota|forbidden|FailedCreate/i.test(c.message ?? "")),
    );
    return condition ? (condition.message ?? condition.reason ?? "FailedCreate") : null;
  }

  private async inspectJobPods(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<{
    everStarted: boolean;
    unschedulableReason: string | null;
    containerRunning: boolean;
    imagePull: { reason: string; message: string } | null;
  }> {
    try {
      signal.throwIfAborted();
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
      let everStarted = false;
      let unschedulableReason: string | null = null;
      let containerRunning = false;
      let imagePull: { reason: string; message: string } | null = null;
      for (const pod of pods.items) {
        const status = pod.status;
        const phase = status?.phase;
        if (status?.startTime || phase === "Running" || phase === "Succeeded") {
          everStarted = true;
        }
        if (phase === "Failed" && status?.startTime) {
          everStarted = true;
        }
        for (const cs of [
          ...(status?.initContainerStatuses ?? []),
          ...(status?.containerStatuses ?? []),
        ]) {
          if (cs.state?.running || cs.state?.terminated) {
            containerRunning = true;
          }
          const waitingReason = cs.state?.waiting?.reason;
          if (waitingReason === "ImagePullBackOff" || waitingReason === "ErrImagePull") {
            imagePull = {
              reason: waitingReason,
              message: cs.state?.waiting?.message ?? waitingReason,
            };
          }
        }
        const scheduled = (status?.conditions ?? []).find((c) => c.type === "PodScheduled");
        if (scheduled?.status === "False" && scheduled.reason === "Unschedulable") {
          unschedulableReason = scheduled.message ?? scheduled.reason;
        }
      }
      return { everStarted, unschedulableReason, containerRunning, imagePull };
    } catch {
      signal.throwIfAborted();
      return {
        everStarted: false,
        unschedulableReason: null,
        containerRunning: false,
        imagePull: null,
      };
    }
  }

  private async waitForJobOutcome(
    jobName: string,
    namespace: string,
    deadlineSeconds: number,
    signal: AbortSignal,
  ): Promise<{ state: "succeeded" | "failed"; deadlineExceeded: boolean }> {
    const startedAt = Date.now();
    const deadline = startedAt + (deadlineSeconds + JOB_DEADLINE_BUFFER_SECONDS) * 1_000;
    let everStarted = false;
    let containerRunning = false;

    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const job = await this.batchApi.readNamespacedJob({
        name: jobName,
        namespace,
      });
      signal.throwIfAborted();

      if (job.status?.succeeded) return { state: "succeeded", deadlineExceeded: false };
      if (job.status?.failed) {
        const blockedReason = this.jobBlockedReason(job);
        if (blockedReason) {
          throw new SandboxBackpressureError(
            `Sandbox Job ${jobName} could not create pods (${blockedReason}); retrying with backoff.`,
          );
        }
        const deadlineExceeded = (job.status.conditions ?? []).some(
          (c) => c.reason === "DeadlineExceeded",
        );
        return { state: "failed", deadlineExceeded };
      }

      if (!containerRunning) {
        const pods = await this.inspectJobPods(jobName, namespace, signal);

        if (pods.imagePull?.reason === "ImagePullBackOff") {
          throw new SandboxImagePullError(
            `Cannot pull image for Job ${jobName}: ${pods.imagePull.message}`,
          );
        }

        containerRunning = pods.containerRunning;

        if (!everStarted) {
          everStarted = pods.everStarted;

          if (!everStarted && Date.now() - startedAt > POD_SCHEDULE_GRACE_MS) {
            const blockedReason = this.jobBlockedReason(job);
            if (blockedReason || pods.unschedulableReason) {
              throw new SandboxBackpressureError(
                `Sandbox Job ${jobName} pod never scheduled (${blockedReason ?? pods.unschedulableReason ?? "quota/capacity"}); retrying with backoff.`,
              );
            }
          }
        }
      }

      await this.sleep(JOB_POLL_INTERVAL_MS, signal);
    }

    if (!everStarted) {
      throw new SandboxBackpressureError(
        `Sandbox Job ${jobName} produced no running pod before the deadline (quota/capacity backpressure); retrying with backoff.`,
      );
    }

    return { state: "failed", deadlineExceeded: true };
  }

  private async getPodLogs(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.getContainerLogs(jobName, namespace, "runner", signal);
  }

  private async getContainerLogs(
    jobName: string,
    namespace: string,
    container: string,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const pods = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });
    signal.throwIfAborted();

    const podName = pods.items[0]?.metadata?.name;
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    const logs = await this.coreApi
      .readNamespacedPodLog({ container, name: podName, namespace })
      .catch(() => "");
    signal.throwIfAborted();
    return logs;
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(executionAbortReason(signal));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  private parseRunnerOutput(logs: string): SandboxResult | null {
    return scanJsonLinesFromEnd(logs, (json) => {
      const parsed = parseSandboxResult(json);
      return parsed.success ? parsed.data : null;
    });
  }

  private async cleanup(
    jobName: string,
    namespace: string,
    payloadNames: string[],
  ): Promise<void> {
    await runCleanupOperations("sandbox", [
      this.cleanupJob(jobName, namespace),
      ...payloadNames.map((name) => this.cleanupConfigMap(name, namespace)),
    ]);
  }
}
