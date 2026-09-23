import {
  failureMessage,
  k8sErrorCode,
  boundedK8sCall,
  retryK8sCleanupCall,
} from "./cleanup-call";
import { createRequire } from "node:module";
import {
  podPhaseTimings,
  recordJudgePhase,
  recordCleanupPending,
  recordRunnerResources,
  type JudgePhase,
  type JudgeMode,
} from "../shared/judge-phase-metrics";
import {
  terminateSandboxJob,
  terminateSandboxPod,
  terminateSandboxPvc,
  SandboxCleanupBudget,
  SandboxCleanupPendingError,
  isK8sNotFound,
} from "./termination";
import { hostname } from "node:os";

import type * as k8s from "@kubernetes/client-node";
import { findSuffix, quantityToScalar } from "@kubernetes/client-node/dist/util.js";

const require = createRequire(import.meta.url);

import {
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
  DEFAULT_MAX_MEMORY_MB,
  DEFAULT_MEMORY_HEADROOM_MB,
  MIN_COMPILER_MEMORY_MB,
  resolveContainerMemoryMb,
  type SandboxExecutionContext,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";
import { createLogger } from "../../logger.js";
import {
  resolveInteractiveStage,
  type InteractiveSideResult,
} from "../shared/check-interactive";
import { executionAbortReason } from "../shared/execution-abort";
import { advancedFallbackResult, mapAdvancedResult } from "../shared/sandbox-result-mapper";
import { sandboxSystemError } from "../shared/sandbox-plan";
import {
  buildRunConfigMapData,
  buildInteractiveInteractorConfigMapData,
  buildInteractiveSolutionConfigMapData,
  computeInteractiveJobDeadlineSeconds,
  computeStageJobDeadlineSeconds,
  CONFIGMAP_MAX_BYTES,
} from "./configmaps";
import {
  buildInteractiveJobManifest,
  buildStageJobManifest,
  JUDGE_CONTAINER_NAME,
  RUN_CONTAINER_NAME,
} from "./job-manifests";
import { buildPayloadConfigMaps, payloadConfigMapNames } from "./payload";
import {
  buildJudgePayload,
  completeRuns,
  gradableRuns,
  mergeStageResults,
  parseCompilationError,
  parseJudgeOutcomes,
  parseRunResult,
} from "../shared/stage-result";
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
} from "./advanced";
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
} from "./advanced-network";

const logger = createLogger("k8s-executor");

export interface K8sExecutorConfig {
  namespace: string;
  image: string;
  cpuRequest: string;
  cpuLimit: string;
  runParallelism?: number;
  memoryRequest: string;
  memoryLimit: string;
  headroomMb?: number;
  maxMemoryMb?: number;
  imagePullSecretName?: string;
  sidecarReadinessTimeoutMs?: number;
  sidecarReadinessIntervalMs?: number;
  runtimeClassName?: string;
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
const POD_SCHEDULE_GRACE_MS = 30_000;
const JOB_WATCH_TIMEOUT_SECONDS = 30;
const JOB_WATCH_RECONNECT_BASE_DELAY_MS = 100;
const JOB_WATCH_RECONNECT_MAX_DELAY_MS = 2_000;
const RUNNER_MEMORY_MB = 128;

function jobWatchReconnectDelay(attempt: number): number {
  return Math.min(
    JOB_WATCH_RECONNECT_MAX_DELAY_MS,
    JOB_WATCH_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 5),
  );
}

function infrastructureFailureReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^(Evicted|Shutdown|NodeShutdown|NodeLost|Preempted|DisruptionTarget)$/i.test(value) ||
    /(?:node (?:was )?(?:lost|shutdown|shutting down)|spot interruption|preempted|evicted)/i.test(
      value,
    )
    ? value
    : null;
}

export function findFailedCreateEventReason(events: readonly k8s.CoreV1Event[]): string | null {
  const event = events.find(
    (candidate) => candidate.type === "Warning" && candidate.reason === "FailedCreate",
  );
  if (!event) return null;
  return `${event.reason ?? "FailedCreate"}: ${event.message ?? "Kubernetes rejected pod creation."}`;
}

function isDeterministicAdmissionFailure(reason: string): boolean {
  if (/exceeded quota/i.test(reason)) return false;
  return /forbidden|limit range|maximum .*memory|must be less|invalid.*(?:memory|cpu)/i.test(
    reason,
  );
}

function rethrowSandboxQuotaError(error: unknown): never {
  const message =
    typeof error === "object" && error !== null && "body" in error
      ? failureMessage(error.body)
      : failureMessage(error);
  if (k8sErrorCode(error) === 403 && /exceeded quota/i.test(message)) {
    throw new SandboxBackpressureError(
      `Sandbox resource creation is waiting for capacity: ${message}`,
    );
  }
  throw error;
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
  if (!(executionFailure instanceof Error) || executionFailure.name !== "AbortError") {
    return new SandboxCleanupError(
      `${failureMessage(executionFailure)} Cleanup also failed: ${cleanup}`,
      { cause: cleanupFailure },
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
    throw new SandboxCleanupError(failureMessage(cleanupFailure), { cause: cleanupFailure });
  }
}

async function runCleanupOperations(
  label: string,
  operations: Promise<unknown>[],
): Promise<void> {
  const results = await Promise.allSettled(operations);
  throwCleanupFailures(label, results);
}

export class SandboxBackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxBackpressureError";
  }
}

export class SandboxAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxAdmissionError";
  }
}

export class SandboxInfeasibleError extends SandboxAdmissionError {
  constructor(message: string) {
    super(message);
    this.name = "SandboxInfeasibleError";
  }
}

export class SandboxImagePullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxImagePullError";
  }
}

export class SandboxInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxInfrastructureError";
  }
}

export class SandboxTransientInfrastructureError extends SandboxInfrastructureError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxTransientInfrastructureError";
  }
}

export class SandboxCleanupError extends SandboxInfrastructureError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxCleanupError";
  }
}

function quotaQuantity(quantity: string): number {
  const suffix = findSuffix(quantity);
  const value = suffix
    ? Number(quantity.slice(0, -suffix.length)) * Number(quantityToScalar(`1${suffix}`))
    : Number(quantityToScalar(quantity));
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid resource quantity: ${quantity}`);
  return value;
}

function podResourceRequirement(
  spec: k8s.V1PodSpec,
  field: "requests" | "limits",
  resource: "cpu" | "memory",
): number | null {
  const podLevel = spec.resources?.[field]?.[resource];
  const containers = [...spec.containers, ...(spec.initContainers ?? [])];
  if (
    field === "limits" &&
    podLevel === undefined &&
    containers.some((container) => container.resources?.limits?.[resource] === undefined)
  )
    return null;
  // Omitted requests are a lower bound: admission may supply LimitRange defaults.
  const amount = (container: k8s.V1Container) =>
    quotaQuantity(container.resources?.[field]?.[resource] ?? "0");
  let regular = spec.containers.reduce((total, container) => total + amount(container), 0);
  let restartable = 0;
  let initPeak = 0;
  for (const container of spec.initContainers ?? []) {
    const own = amount(container);
    if (container.restartPolicy === "Always") {
      restartable += own;
      initPeak = Math.max(initPeak, restartable);
    } else initPeak = Math.max(initPeak, restartable + own);
  }
  regular += restartable;
  const effective =
    podLevel === undefined ? Math.max(regular, initPeak) : quotaQuantity(podLevel);
  const overhead =
    field === "requests" || effective > 0 ? quotaQuantity(spec.overhead?.[resource] ?? "0") : 0;
  return effective + overhead;
}

export function findSandboxQuotaViolation(
  pods: k8s.V1PodSpec[],
  quotas: k8s.V1ResourceQuota[],
): string | null {
  const requirements: Record<string, number | null> = {
    pods: pods.length,
    "count/pods": pods.length,
  };
  for (const field of ["requests", "limits"] as const) {
    for (const resource of ["cpu", "memory"] as const) {
      const values = pods.map((pod) => podResourceRequirement(pod, field, resource));
      requirements[`${field}.${resource}`] = values.some((value) => value === null)
        ? null
        : values.reduce<number>((total, value) => total + (value ?? 0), 0);
      if (field === "requests")
        requirements[resource] = requirements[`${field}.${resource}`] ?? null;
    }
  }
  for (const quota of quotas) {
    // Only prove violations without guessing admission scope/defaulting behavior.
    if (
      (quota.spec?.scopes?.length ?? 0) > 0 ||
      (quota.spec?.scopeSelector?.matchExpressions?.length ?? 0) > 0
    )
      continue;
    const hard = quota.status?.hard ?? quota.spec?.hard ?? {};
    for (const [resource, requested] of Object.entries(requirements)) {
      const configured = hard[resource];
      if (configured === undefined || requested === null) continue;
      const maximum = quotaQuantity(configured);
      const tolerance = Math.max(1, requested, maximum) * Number.EPSILON * 128;
      if (requested > maximum + tolerance) {
        return `ResourceQuota ${quota.metadata?.name ?? "unnamed"}: ${resource} requires ${String(requested)}, exceeding hard ${configured}.`;
      }
    }
  }
  return null;
}

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
  networkingApi?: k8s.NetworkingV1Api;
  watch: K8sWatchClient;
}

export interface K8sWatchClient {
  watch(
    path: string,
    queryParams: Record<string, string | number | boolean | undefined>,
    callback: (phase: string, apiObj: unknown) => void,
    done: (err: unknown) => void,
  ): Promise<AbortController>;
}

interface JobWatchSnapshot {
  job: k8s.V1Job;
  pods: k8s.V1Pod[];
  jobResourceVersion?: string;
  podResourceVersion?: string;
}

interface JobWatchEvaluation {
  everStarted: boolean;
  outcome: { state: "succeeded" | "failed"; deadlineExceeded: boolean } | null;
}

interface JobPodSummary {
  everStarted: boolean;
  unschedulableReason: string | null;
  succeeded: boolean;
  imagePull: { reason: string; message: string } | null;
  infrastructureFailure: string | null;
}

function summarizeJobPods(pods: k8s.V1Pod[]): JobPodSummary {
  let everStarted = false;
  let unschedulableReason: string | null = null;
  let succeeded = false;
  let imagePull: { reason: string; message: string } | null = null;
  let infrastructureFailure: string | null = null;

  for (const pod of pods) {
    const status = pod.status;
    const phase = status?.phase;
    if (phase === "Succeeded") succeeded = true;
    if (
      phase === "Succeeded" ||
      (status?.containerStatuses ?? []).some(
        (container) => container.state?.running ?? container.state?.terminated,
      )
    )
      everStarted = true;

    for (const value of [status?.reason, status?.message]) {
      const reason = infrastructureFailureReason(value);
      if (reason) {
        infrastructureFailure = reason;
        break;
      }
    }

    for (const containerStatus of [
      ...(status?.initContainerStatuses ?? []),
      ...(status?.containerStatuses ?? []),
    ]) {
      const waitingReason = containerStatus.state?.waiting?.reason;
      if (waitingReason === "ImagePullBackOff" || waitingReason === "ErrImagePull") {
        imagePull = {
          reason: waitingReason,
          message: containerStatus.state?.waiting?.message ?? waitingReason,
        };
      }
      for (const value of [
        containerStatus.state?.terminated?.reason,
        containerStatus.state?.terminated?.message,
      ].filter((value): value is string => typeof value === "string")) {
        const reason = infrastructureFailureReason(value);
        if (reason) {
          infrastructureFailure = reason;
          break;
        }
      }
    }

    const scheduled = (status?.conditions ?? []).find(
      (condition) => condition.type === "PodScheduled",
    );
    if (scheduled?.status === "False" && scheduled.reason === "Unschedulable") {
      unschedulableReason = scheduled.message ?? scheduled.reason;
    }
  }

  return { everStarted, unschedulableReason, succeeded, imagePull, infrastructureFailure };
}

function watchErrorCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  if ("code" in error && typeof error.code === "number") return error.code;
  if (
    "status" in error &&
    typeof error.status === "object" &&
    error.status !== null &&
    "code" in error.status &&
    typeof error.status.code === "number"
  ) {
    return error.status.code;
  }
  return null;
}

function requestMode(request: SandboxRequest): JudgeMode {
  return request.advanced ? "advanced" : request.judgeType;
}

export class K8sExecutor implements SandboxExecutor {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batchApi: k8s.BatchV1Api;
  private networkingApiHandle: k8s.NetworkingV1Api | undefined;
  private readonly watchClient: K8sWatchClient;

  constructor(
    private readonly config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      this.networkingApiHandle = clients.networkingApi;
      this.watchClient = clients.watch;
      return;
    }
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
    this.networkingApiHandle = kc.makeApiClient(k8sLib.NetworkingV1Api);
    this.watchClient = new k8sLib.Watch(kc);
  }

  async cleanupRun(runId: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Invalid cleanup run ID");
    const namespace = this.config.namespace;
    const prefix = `judge-${runId}`;
    const owned = (metadata: k8s.V1ObjectMeta | undefined) =>
      metadata?.name === prefix || metadata?.name?.startsWith(`${prefix}-`) === true;
    const budget = new SandboxCleanupBudget();
    const call = <T>(operation: () => Promise<T>) => budget.call(`Run ${runId}`, operation);
    const jobs = await call(() => this.batchApi.listNamespacedJob({ namespace }));
    for (const job of jobs.items.filter((item) => owned(item.metadata))) {
      if (!job.metadata?.name) throw new SandboxCleanupPendingError([prefix]);
      await this.cleanupJob(job.metadata.name, namespace, budget);
    }
    const pods = await call(() => this.coreApi.listNamespacedPod({ namespace }));
    for (const pod of pods.items.filter((item) => owned(item.metadata))) {
      if (!pod.metadata?.uid || !pod.metadata.name)
        throw new SandboxCleanupPendingError([prefix]);
      await terminateSandboxPod(this.coreApi, namespace, pod.metadata.name, {
        expectedUid: pod.metadata.uid,
        budget,
      });
    }
    const remove = async (
      items: { metadata?: k8s.V1ObjectMeta }[],
      deleteResource: (name: string, uid: string) => Promise<unknown>,
    ) => {
      for (const resource of items.filter((item) => owned(item.metadata))) {
        if (!resource.metadata?.uid || !resource.metadata.name)
          throw new SandboxCleanupPendingError([prefix]);
        const { name, uid } = resource.metadata;
        try {
          await call(() => deleteResource(name, uid));
        } catch (error) {
          if (!isK8sNotFound(error)) throw error;
        }
      }
    };
    await remove(
      (await call(() => this.coreApi.listNamespacedConfigMap({ namespace }))).items,
      (name, uid) =>
        this.coreApi.deleteNamespacedConfigMap({
          namespace,
          name,
          body: { preconditions: { uid } },
        }),
    );
    const pvcs = await call(() =>
      this.coreApi.listNamespacedPersistentVolumeClaim({ namespace }),
    );
    for (const pvc of pvcs.items.filter((item) => owned(item.metadata))) {
      if (!pvc.metadata?.uid || !pvc.metadata.name)
        throw new SandboxCleanupPendingError([prefix]);
      await terminateSandboxPvc(this.coreApi, namespace, pvc.metadata.name, pvc.metadata.uid, {
        budget,
      });
    }
    await remove(
      (await call(() => this.coreApi.listNamespacedService({ namespace }))).items,
      (name, uid) =>
        this.coreApi.deleteNamespacedService({
          namespace,
          name,
          body: { preconditions: { uid } },
        }),
    );
    await remove(
      (await call(() => this.networkingApi().listNamespacedNetworkPolicy({ namespace }))).items,
      (name, uid) =>
        this.networkingApi().deleteNamespacedNetworkPolicy({
          namespace,
          name,
          body: { preconditions: { uid } },
        }),
    );
  }

  private async observeJobLifecycle(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
  ): Promise<void> {
    try {
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      for (const pod of pods.items) {
        const timings = podPhaseTimings(pod, requestMode(request));
        for (const [phase, milliseconds] of Object.entries(timings))
          recordJudgePhase(
            phase as JudgePhase,
            milliseconds,
            requestMode(request),
            request.language,
          );
        logger.info("Kubernetes sandbox lifecycle timings", {
          jobName,
          podUid: pod.metadata?.uid,
          timings,
        });
      }
    } catch (error) {
      logger.warn("Kubernetes sandbox lifecycle timings unavailable", {
        jobName,
        error: failureMessage(error),
      });
    }
  }

  private async observeContainerResources(
    jobName: string,
    namespace: string,
    container: string,
    request: SandboxRequest,
    phase: JudgePhase,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const logs = await this.getContainerLogs(jobName, namespace, container, signal);
      recordRunnerResources(logs, requestMode(request), request.language, phase, {
        jobName,
        container,
      });
    } catch (error) {
      logger.warn("Kubernetes sandbox resource metrics unavailable", {
        jobName,
        container,
        error: failureMessage(error),
      });
    }
  }

  private async measurePhase<T>(
    request: SandboxRequest,
    phase: "collect" | "cleanup",
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    let success = false;
    try {
      const result = await operation();
      success = true;
      return result;
    } finally {
      recordJudgePhase(
        phase,
        Date.now() - started,
        requestMode(request),
        request.language,
        success ? "success" : "failure",
      );
      if (!success && phase === "cleanup")
        recordCleanupPending(requestMode(request), request.language);
    }
  }

  private runMetadata(metadata: k8s.V1ObjectMeta | undefined): k8s.V1ObjectMeta {
    const runId =
      /^judge-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:-|$)/.exec(
        metadata?.name ?? "",
      )?.[1];
    const result = metadata ?? {};
    if (runId) result.labels = { ...result.labels, "nojv-run-id": runId };
    return result;
  }

  private imagePullCredentials(spec: k8s.V1PodSpec): void {
    const name = this.config.imagePullSecretName;
    if (name && !spec.imagePullSecrets?.some((secret) => secret.name === name))
      spec.imagePullSecrets = [...(spec.imagePullSecrets ?? []), { name }];
  }

  private networkingApi(): k8s.NetworkingV1Api {
    if (!this.networkingApiHandle) {
      throw new Error("NetworkingV1Api client is not available");
    }
    return this.networkingApiHandle;
  }

  async reconcile(runId: string, owner?: string): Promise<boolean> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId))
      return false;
    if (!owner) return false;
    if (owner !== (process.env.HOSTNAME ?? hostname())) {
      try {
        const worker = await boundedK8sCall(
          this.coreApi.readNamespacedPod({
            namespace: process.env.POD_NAMESPACE ?? "nojv",
            name: owner,
          }),
          `Worker Pod ${owner}`,
        );
        if (worker.status?.phase !== "Succeeded" && worker.status?.phase !== "Failed")
          return false;
      } catch (error) {
        if (k8sErrorCode(error) !== 404) return false;
      }
    }
    const namespace = this.config.namespace;
    const prefix = `judge-${runId}`;
    const owned = (metadata: k8s.V1ObjectMeta | undefined) =>
      metadata?.name === prefix || metadata?.name?.startsWith(`${prefix}-`) === true;
    interface Resource {
      metadata?: k8s.V1ObjectMeta;
    }
    interface ResourceKind {
      kind: string;
      workload: boolean;
      list: () => Promise<{ items: Resource[] }>;
      remove: (name: string, uid: string) => Promise<unknown>;
    }
    try {
      const networking = this.networkingApi();
      const kinds: ResourceKind[] = [
        {
          kind: "Job",
          workload: true,
          list: () => this.batchApi.listNamespacedJob({ namespace }),
          remove: (name, uid) =>
            this.batchApi.deleteNamespacedJob({
              namespace,
              name,
              body: { propagationPolicy: "Foreground", preconditions: { uid } },
            }),
        },
        {
          kind: "Pod",
          workload: true,
          list: () => this.coreApi.listNamespacedPod({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedPod({
              namespace,
              name,
              body: { propagationPolicy: "Foreground", preconditions: { uid } },
            }),
        },
        {
          kind: "ConfigMap",
          workload: false,
          list: () => this.coreApi.listNamespacedConfigMap({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedConfigMap({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "PersistentVolumeClaim",
          workload: false,
          list: () => this.coreApi.listNamespacedPersistentVolumeClaim({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedPersistentVolumeClaim({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "Service",
          workload: false,
          list: () => this.coreApi.listNamespacedService({ namespace }),
          remove: (name, uid) =>
            this.coreApi.deleteNamespacedService({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
        {
          kind: "NetworkPolicy",
          workload: false,
          list: () => networking.listNamespacedNetworkPolicy({ namespace }),
          remove: (name, uid) =>
            networking.deleteNamespacedNetworkPolicy({
              namespace,
              name,
              body: { preconditions: { uid } },
            }),
        },
      ];
      const inventory = async (selected: ResourceKind[]) =>
        Promise.all(
          selected.map(async (kind) => {
            const { items } = await boundedK8sCall(
              kind.list(),
              `${kind.kind} list in ${namespace}`,
            );
            return { kind, items: items.filter(({ metadata }) => owned(metadata)) };
          }),
        );
      const initial = await inventory(kinds);
      if (
        initial.some(({ items }) =>
          items.some(({ metadata }) => !metadata?.uid || metadata.namespace !== namespace),
        )
      )
        return false;
      const remove = async (workload: boolean) => {
        const results = await Promise.allSettled(
          initial
            .filter(({ kind }) => kind.workload === workload)
            .flatMap(({ kind, items }) =>
              items.map(async ({ metadata }) => {
                if (!metadata?.name || !metadata.uid || metadata.deletionTimestamp) return;
                const { name, uid } = metadata;
                await retryK8sCleanupCall(
                  `${kind.kind} ${namespace}/${name}`,
                  () => kind.remove(name, uid),
                  { notFoundIsSuccess: true },
                );
              }),
            ),
        );
        return results.every((result) => result.status === "fulfilled");
      };
      if (!(await remove(true))) return false;
      const workloads = await inventory(kinds.filter((kind) => kind.workload));
      if (workloads.some(({ items }) => items.length > 0)) return false;
      if (!(await remove(false))) return false;
      return (await inventory(kinds)).every(({ items }) => items.length === 0);
    } catch (error) {
      logger.warn("Sandbox recovery could not confirm resource cleanup", {
        runId,
        error: failureMessage(error),
      });
      return false;
    }
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

      return await this.runStagePod(request, execution);
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
        if (
          err instanceof SandboxInfrastructureError ||
          err instanceof SandboxImagePullError ||
          err instanceof SandboxBackpressureError ||
          err instanceof SandboxAdmissionError
        )
          throw err;
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

      await this.createSandboxJob(
        {
          namespace: ns,
          body: buildAdvancedRunJobManifest({
            jobName: runJobName,
            namespace: ns,
            configMapName: runConfigMapName,
            pvcName,
            sandboxImage: request.sandboxImage ?? this.config.image,
            runImage: advanced.run.imageRef,
            memoryMb: advanced.memoryMb,
            totalTimeMs: advanced.totalTimeMs,
            cpuLimit: this.config.cpuLimit,
            submissionId: resourceId,
            language: request.language,
            ...(this.config.runtimeClassName
              ? { runtimeClassName: this.config.runtimeClassName }
              : {}),
            ...(hasSidecar ? { egressLabel: runEgressLabel(resourceId) } : {}),
            ...(runExtraEnv ? { extraEnv: runExtraEnv } : {}),
            ...(this.config.imagePullSecretName
              ? { imagePullSecretName: this.config.imagePullSecretName }
              : {}),
          }),
        },
        execution.signal,
        hasSidecar ? sidecarPodName(resourceId) : undefined,
      ).catch(rethrowSandboxQuotaError);
      execution.signal.throwIfAborted();

      const runOutcome = await this.waitForJobOutcome(
        runJobName,
        ns,
        deadlineSeconds,
        execution.signal,
      );
      await this.observeJobLifecycle(runJobName, ns, request);
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
      await this.measurePhase(request, "cleanup", () =>
        this.cleanupAdvancedJob(runJobName, ns),
      );

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
      await this.createSandboxJob(
        {
          namespace: ns,
          body: buildAdvancedGradeJobManifest({
            jobName: gradeJobName,
            namespace: ns,
            configMapName: gradeConfigMapName,
            pvcName,
            sandboxImage: request.sandboxImage ?? this.config.image,
            gradeImage: advanced.grade.imageRef,
            memoryMb: advanced.memoryMb,
            totalTimeMs: advanced.totalTimeMs,
            cpuLimit: this.config.cpuLimit,
            submissionId: resourceId,
            language: request.language,
            nodeName,
            egressLabel: gradeEgressLabel(resourceId),
            ...(this.config.runtimeClassName
              ? { runtimeClassName: this.config.runtimeClassName }
              : {}),
            ...(this.config.imagePullSecretName
              ? { imagePullSecretName: this.config.imagePullSecretName }
              : {}),
          }),
        },
        execution.signal,
        hasSidecar ? sidecarPodName(resourceId) : undefined,
      ).catch(rethrowSandboxQuotaError);
      execution.signal.throwIfAborted();

      await this.waitForJobCompletion(gradeJobName, ns, deadlineSeconds, execution.signal);
      await this.observeJobLifecycle(gradeJobName, ns, request);
      const gradePodName = await this.findPodName(gradeJobName, ns, execution.signal);
      if (!gradePodName) {
        return advancedFallbackResult(request, "Advanced grade phase produced no pod.");
      }

      const sidecarLog = await this.measurePhase(request, "collect", () =>
        this.getPodContainerLogs(gradePodName, ns, ADVANCED_SIDECAR_NAME, execution.signal),
      );
      recordRunnerResources(sidecarLog, "advanced", request.language, "checker", {
        jobName: gradeJobName,
        container: ADVANCED_SIDECAR_NAME,
      });
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
      await this.measurePhase(request, "cleanup", () =>
        runCleanupAfterExecution(executionFailure, async () => {
          const budget = new SandboxCleanupBudget();
          const jobCleanup = await Promise.allSettled([
            this.cleanupAdvancedJob(runJobName, ns, budget),
            this.cleanupAdvancedJob(gradeJobName, ns, budget),
          ]);
          const runPodsGone = jobCleanup[0].status === "fulfilled";
          const gradePodsGone = jobCleanup[1].status === "fulfilled";
          throwCleanupFailures("advanced sandbox termination", jobCleanup);
          await this.teardownAdvancedNetwork(
            resourceId,
            ns,
            hasSidecar,
            { runPodsGone, gradePodsGone },
            budget,
          );
          const privateDataCleanup = await Promise.allSettled([
            this.cleanupConfigMap(runConfigMapName, ns, budget),
            this.cleanupConfigMap(gradeConfigMapName, ns, budget),
            this.cleanupPvc(pvcName, ns, budget),
          ]);
          throwCleanupFailures("advanced sandbox", [...jobCleanup, ...privateDataCleanup]);
        }),
      );
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
    await this.createSandboxPod(
      {
        namespace: ns,
        body: buildServiceSidecarPodManifest({
          submissionId: resourceId,
          namespace: ns,
          image: service.imageRef,
          memoryMb: advanced.memoryMb,
          cpuLimit: this.config.cpuLimit,
          port: SIDECAR_PORT,
          ...(this.config.runtimeClassName
            ? { runtimeClassName: this.config.runtimeClassName }
            : {}),
          ...(this.config.imagePullSecretName
            ? { imagePullSecretName: this.config.imagePullSecretName }
            : {}),
        }),
      },
      signal,
    ).catch(rethrowSandboxQuotaError);
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
    const created = await this.coreApi
      .createNamespacedService({
        namespace: ns,
        body: buildSidecarServiceManifest({ submissionId, namespace: ns, port: SIDECAR_PORT }),
      })
      .catch(rethrowSandboxQuotaError);
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
    let everStarted = false;
    let waitingReason: string | null = null;
    while (Date.now() < deadline) {
      let pods: k8s.V1PodList;
      try {
        pods = await this.coreApi.listNamespacedPod({
          namespace: ns,
          fieldSelector: `metadata.name=${podName}`,
        });
      } catch (error) {
        signal.throwIfAborted();
        throw new SandboxInfrastructureError(
          `Could not inspect service pod ${ns}/${podName}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      signal.throwIfAborted();
      const pod = pods.items[0];
      const summary = summarizeJobPods(pods.items);
      everStarted ||= summary.everStarted;
      waitingReason = summary.unschedulableReason;
      if (summary.imagePull?.reason === "ImagePullBackOff") {
        throw new SandboxImagePullError(
          `Service image pull failed for ${ns}/${podName}: ${summary.imagePull.message}`,
        );
      }
      if (summary.infrastructureFailure) {
        throw new SandboxTransientInfrastructureError(
          `Service pod ${ns}/${podName} was interrupted by infrastructure (${summary.infrastructureFailure}).`,
        );
      }
      const service = pod?.status?.containerStatuses?.find(
        (status) => status.name === "service",
      );
      if (service?.state?.running || service?.state?.terminated) {
        const log = await this.getPodContainerLogs(podName, ns, "service", signal);
        if (log.includes(marker)) return true;
      }
      await this.sleep(intervalMs, signal);
    }
    if (!everStarted) {
      throw new SandboxBackpressureError(
        `Service pod ${ns}/${podName} did not start before the readiness deadline: ${waitingReason ?? "waiting for container startup"}.`,
      );
    }
    return false;
  }

  private async createNamespacedNetworkPolicy(
    ns: string,
    body: k8s.V1NetworkPolicy,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.networkingApi()
      .createNamespacedNetworkPolicy({ namespace: ns, body })
      .catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }

  private async teardownAdvancedNetwork(
    submissionId: string,
    ns: string,
    hasSidecar: boolean,
    podsGone: { runPodsGone: boolean; gradePodsGone: boolean },
    budget = new SandboxCleanupBudget(),
  ): Promise<void> {
    if (hasSidecar) await this.cleanupAdvancedPod(sidecarPodName(submissionId), ns, budget);
    const remove = async (resource: string, operation: () => Promise<unknown>) => {
      try {
        await budget.call(resource, operation);
      } catch (error) {
        if (!isK8sNotFound(error)) throw error;
      }
    };
    const networkingApi = this.networkingApi();
    const deletePolicy = (name: string) =>
      remove(`NetworkPolicy ${ns}/${name}`, () =>
        networkingApi.deleteNamespacedNetworkPolicy({ name, namespace: ns }),
      );
    const cleanup: Promise<unknown>[] = [];
    if (podsGone.gradePodsGone) cleanup.push(deletePolicy(gradePolicyName(submissionId)));
    if (hasSidecar) {
      cleanup.push(
        remove(`Service ${ns}/${sidecarServiceName(submissionId)}`, () =>
          this.coreApi.deleteNamespacedService({
            name: sidecarServiceName(submissionId),
            namespace: ns,
          }),
        ),
      );
      if (podsGone.runPodsGone) cleanup.push(deletePolicy(runPolicyName(submissionId)));
      cleanup.push(deletePolicy(sidecarPolicyName(submissionId)));
    }
    throwCleanupFailures("advanced network", await Promise.allSettled(cleanup));
  }

  private async executeInteractive(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    if (!request.judgeConfig.interactorScript) {
      return sandboxSystemError("Interactive judge is missing its interactor script.");
    }
    if (request.testcases.length === 0) return { testcaseResults: [] };
    return this.runInteractiveStage(
      `judge-${execution.runId}-int`,
      this.config.namespace,
      request,
      execution.signal,
    );
  }

  private async runInteractiveStage(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    signal: AbortSignal,
  ): Promise<SandboxResult> {
    const solConfigMap = `${jobName}-sol`;
    const intConfigMap = `${jobName}-int`;
    let solutionPayloadNames: string[] = [];
    let interactorPayloadNames: string[] = [];
    let executionFailure: { reason: unknown } | undefined;

    const seCase = (message: string): SandboxResult => ({
      testcaseResults: request.testcases.map((testcase) => ({
        index: testcase.index,
        verdict: "SE",
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        feedback: message,
      })),
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
        buildInteractiveInteractorConfigMapData(request),
        signal,
      );

      const deadlineSeconds = computeInteractiveJobDeadlineSeconds(request);
      await this.createSandboxJob(
        {
          namespace,
          body: buildInteractiveJobManifest({
            jobName,
            namespace,
            solutionConfigMapNames: solutionPayloadNames,
            interactorConfigMapNames: interactorPayloadNames,
            image: request.sandboxImage ?? this.config.image,
            cpuRequest: this.config.cpuRequest,
            cpuLimit: this.config.cpuLimit,
            memoryRequest: this.config.memoryRequest,
            memoryLimit: resolveK8sMemoryLimit(request, this.config),
            activeDeadlineSeconds: deadlineSeconds,
            ...(this.config.runtimeClassName
              ? { runtimeClassName: this.config.runtimeClassName }
              : {}),
          }),
        },
        signal,
      ).catch(rethrowSandboxQuotaError);
      signal.throwIfAborted();

      const outcome = await this.waitForJobOutcome(jobName, namespace, deadlineSeconds, signal);
      await this.observeJobLifecycle(jobName, namespace, request);
      const podName = await this.findPodName(jobName, namespace, signal);
      if (!podName) {
        if (outcome.state === "failed") {
          return seCase("Interactive sandbox job failed or timed out.");
        }
        return seCase("Interactive sandbox produced no pod.");
      }

      const [solLogs, intLogs] = await this.measurePhase(request, "collect", () =>
        Promise.all([
          this.getPodContainerLogs(podName, namespace, "solution", signal),
          this.getPodContainerLogs(podName, namespace, "interactor", signal),
        ]),
      );
      recordRunnerResources(solLogs, "interactive", request.language, "execute", {
        jobName,
        container: "solution",
      });
      recordRunnerResources(intLogs, "interactive", request.language, "checker", {
        jobName,
        container: "interactor",
      });
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
      return resolveInteractiveStage(request.testcases, sol, int);
    } catch (err) {
      if (signal.aborted) {
        const reason = executionAbortReason(signal);
        executionFailure = { reason };
        throw reason;
      }
      if (
        err instanceof SandboxAdmissionError ||
        err instanceof SandboxBackpressureError ||
        err instanceof SandboxImagePullError ||
        err instanceof SandboxInfrastructureError
      ) {
        executionFailure = { reason: err };
        throw err;
      }
      logger.error("K8s interactive stage failed", {
        submissionId: request.submissionId,
        jobName,
        err: err instanceof Error ? err.message : String(err),
      });
      return seCase("Interactive sandbox failed to start.");
    } finally {
      await this.measurePhase(request, "cleanup", () =>
        runCleanupAfterExecution(executionFailure, () =>
          this.cleanup(jobName, namespace, [
            ...solutionPayloadNames,
            ...interactorPayloadNames,
          ]),
        ),
      );
    }
  }

  private async cleanupJob(
    name: string,
    namespace: string,
    budget?: SandboxCleanupBudget,
  ): Promise<void> {
    await terminateSandboxJob(
      this.coreApi,
      this.batchApi,
      namespace,
      name,
      budget ? { budget } : {},
    );
  }

  private async cleanupAdvancedJob(
    name: string,
    namespace: string,
    budget?: SandboxCleanupBudget,
  ): Promise<boolean> {
    await this.cleanupJob(name, namespace, budget);
    return true;
  }

  private async cleanupAdvancedPod(
    name: string,
    namespace: string,
    budget?: SandboxCleanupBudget,
  ): Promise<boolean> {
    await terminateSandboxPod(this.coreApi, namespace, name, budget ? { budget } : {});
    return true;
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
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not find sandbox pod for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
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
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not inspect sandbox pod for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async createPvc(name: string, namespace: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.coreApi
      .createNamespacedPersistentVolumeClaim({
        namespace,
        body: buildAdvancedPvcManifest({ pvcName: name, namespace }),
      })
      .catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }

  private async cleanupPvc(
    name: string,
    namespace: string,
    budget = new SandboxCleanupBudget(),
  ): Promise<void> {
    try {
      await budget.call(`PersistentVolumeClaim ${namespace}/${name}`, () =>
        this.coreApi.deleteNamespacedPersistentVolumeClaim({ name, namespace }),
      );
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
  }

  private async cleanupConfigMap(
    name: string,
    namespace: string,
    budget = new SandboxCleanupBudget(),
  ): Promise<void> {
    try {
      await budget.call(`ConfigMap ${namespace}/${name}`, () =>
        this.coreApi.deleteNamespacedConfigMap({ name, namespace }),
      );
    } catch (error) {
      if (!isK8sNotFound(error)) throw error;
    }
  }

  private stageParallelism(request: SandboxRequest): {
    parallelism: number;
    runMemoryLimit: string;
  } {
    const caseMb = parseMemoryLimitMb(resolveK8sMemoryLimit(request, this.config));
    const maxMb = this.config.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB;
    const parallelism = Math.max(
      1,
      Math.min(
        this.config.runParallelism ?? 1,
        Math.floor((maxMb - RUNNER_MEMORY_MB) / caseMb),
      ),
    );
    const runMb = Math.max(parallelism * caseMb + RUNNER_MEMORY_MB, MIN_COMPILER_MEMORY_MB);
    return { parallelism, runMemoryLimit: `${String(Math.min(runMb, maxMb))}Mi` };
  }

  private async createStagePayloads(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    parallelism: number,
    signal: AbortSignal,
  ): Promise<{ run: string[]; judge: string[] }> {
    const [run, judge] = await Promise.allSettled([
      this.createPayloadConfigMaps(
        `${jobName}-run`,
        namespace,
        buildRunConfigMapData(request, parallelism),
        signal,
      ),
      this.createPayloadConfigMaps(
        `${jobName}-judge`,
        namespace,
        buildJudgePayload(request),
        signal,
      ),
    ]);
    if (run.status === "fulfilled" && judge.status === "fulfilled")
      return { run: run.value, judge: judge.value };
    const created = [run, judge].flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    await Promise.allSettled(created.map((name) => this.cleanupConfigMap(name, namespace)));
    throw run.status === "rejected" ? run.reason : (judge as PromiseRejectedResult).reason;
  }

  private async runStagePod(
    request: SandboxRequest,
    execution: SandboxExecutionContext,
  ): Promise<SandboxResult> {
    if (request.testcases.length === 0) return { testcaseResults: [] };
    const ns = this.config.namespace;
    const jobName = `judge-${execution.runId}`;
    const deadlineSeconds = computeStageJobDeadlineSeconds(request);
    const { parallelism, runMemoryLimit } = this.stageParallelism(request);
    const startedAt = Date.now();
    let payloadReadyAt: number | undefined;
    let jobSubmittedAt: number | undefined;
    let jobFinishedAt: number | undefined;
    let logsReadAt: number | undefined;
    let executionFailure: { reason: unknown } | undefined;
    let payloadNames: string[] = [];

    try {
      const payloads = await this.createStagePayloads(
        jobName,
        ns,
        request,
        parallelism,
        execution.signal,
      );
      payloadNames = [...payloads.run, ...payloads.judge];
      payloadReadyAt = Date.now();
      await this.createStageJob(
        jobName,
        ns,
        payloads,
        deadlineSeconds,
        request,
        parallelism,
        runMemoryLimit,
        execution.signal,
      );
      jobSubmittedAt = Date.now();

      await this.waitForJobCompletion(jobName, ns, deadlineSeconds, execution.signal);
      jobFinishedAt = Date.now();
      await this.observeJobLifecycle(jobName, ns, request);

      const pod = await this.findStagePod(jobName, ns, execution.signal);
      if (!pod) throw new Error(`No pod found for job ${jobName}`);
      const [runLog, judgeLog] = await Promise.all([
        pod.runStarted
          ? this.getPodContainerLogs(pod.name, ns, RUN_CONTAINER_NAME, execution.signal)
          : "",
        pod.judgeStarted
          ? this.getPodContainerLogs(pod.name, ns, JUDGE_CONTAINER_NAME, execution.signal)
          : "",
      ]);
      logsReadAt = Date.now();
      const mode = requestMode(request);
      recordRunnerResources(runLog, mode, request.language, "execute", {
        jobName,
        container: RUN_CONTAINER_NAME,
      });
      recordRunnerResources(judgeLog, mode, request.language, "checker", {
        jobName,
        container: JUDGE_CONTAINER_NAME,
      });

      const compileError = parseCompilationError(runLog);
      if (compileError) return { testcaseResults: [], compilationError: compileError };

      const parsed = runLog ? parseRunResult(runLog) : null;
      if (!parsed?.rawRuns)
        logger.warn("Run container produced no readable result", {
          jobName,
          logBytes: runLog.length,
          logTail: runLog.slice(-200),
          pipelineError: parsed?.pipelineError ?? null,
        });
      const rawRuns = completeRuns(
        request,
        parsed?.rawRuns ?? [],
        parsed?.pipelineError ?? "Run container produced no result.",
      );
      return mergeStageResults(
        request,
        rawRuns,
        parseJudgeOutcomes(judgeLog, gradableRuns(request, rawRuns)),
      );
    } catch (error) {
      executionFailure = { reason: error };
      throw error;
    } finally {
      const cleanupStartedAt = Date.now();
      try {
        await this.measurePhase(request, "cleanup", () =>
          runCleanupAfterExecution(executionFailure, () =>
            this.cleanup(jobName, ns, payloadNames),
          ),
        );
      } finally {
        if (jobFinishedAt !== undefined && logsReadAt !== undefined)
          recordJudgePhase(
            "collect",
            logsReadAt - jobFinishedAt,
            request.judgeType,
            request.language,
          );
        logger.info("Kubernetes sandbox phase timings", {
          submissionId: request.submissionId,
          jobName,
          caseCount: request.testcases.length,
          parallelism,
          payloadConfigMapsMs: payloadReadyAt === undefined ? null : payloadReadyAt - startedAt,
          jobCreateMs:
            jobSubmittedAt === undefined || payloadReadyAt === undefined
              ? null
              : jobSubmittedAt - payloadReadyAt,
          scheduleAndExecutionMs:
            jobSubmittedAt === undefined || jobFinishedAt === undefined
              ? null
              : jobFinishedAt - jobSubmittedAt,
          logsMs:
            jobFinishedAt === undefined || logsReadAt === undefined
              ? null
              : logsReadAt - jobFinishedAt,
          cleanupMs: Date.now() - cleanupStartedAt,
          totalMs: Date.now() - startedAt,
        });
      }
    }
  }

  private async findStagePod(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<{ name: string; runStarted: boolean; judgeStarted: boolean } | null> {
    try {
      signal.throwIfAborted();
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
      const pod = pods.items[0];
      const name = pod?.metadata?.name;
      if (!name) return null;
      const started = (status: k8s.V1ContainerStatus | undefined) =>
        Boolean(status?.state?.terminated ?? status?.state?.running);
      return {
        name,
        runStarted: started(
          pod.status?.initContainerStatuses?.find((c) => c.name === RUN_CONTAINER_NAME),
        ),
        judgeStarted: started(
          pod.status?.containerStatuses?.find((c) => c.name === JUDGE_CONTAINER_NAME),
        ),
      };
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not find sandbox pod for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
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
      signal.throwIfAborted();
      const results = await Promise.allSettled(
        configMaps.map(async (configMap) => {
          configMap.metadata = this.runMetadata(configMap.metadata);
          await this.coreApi
            .createNamespacedConfigMap({ namespace, body: configMap })
            .catch(rethrowSandboxQuotaError);
          const name = configMap.metadata.name;
          if (!name) throw new Error("Created sandbox payload ConfigMap is missing a name.");
          created.push(name);
        }),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failed) throw failed.reason;
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
    await this.coreApi
      .createNamespacedConfigMap({
        namespace,
        body: {
          metadata: this.runMetadata({ name, namespace }),
          data,
        },
      })
      .catch(rethrowSandboxQuotaError);
    signal.throwIfAborted();
  }

  private async assertSandboxQuota(
    pods: k8s.V1PodSpec[],
    namespace: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    let quotas: k8s.V1ResourceQuotaList;
    try {
      quotas = await boundedK8sCall(
        this.coreApi.listNamespacedResourceQuota({ namespace }),
        `ResourceQuota list in ${namespace}`,
      );
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not inspect sandbox hard capacity in ${namespace}.`,
        { cause: error },
      );
    }
    signal.throwIfAborted();
    let violation: string | null;
    try {
      violation = findSandboxQuotaViolation(pods, quotas.items);
    } catch (error) {
      throw new SandboxInfrastructureError("Could not interpret sandbox hard capacity.", {
        cause: error,
      });
    }
    if (violation) throw new SandboxInfeasibleError(violation);
  }

  private async createSandboxJob(
    params: { namespace: string; body: k8s.V1Job },
    signal: AbortSignal,
    companionPodName?: string,
  ): Promise<k8s.V1Job> {
    params.body.metadata = this.runMetadata(params.body.metadata);
    const template = params.body.spec?.template;
    if (template) {
      template.metadata ??= {};
      template.metadata.labels = {
        ...template.metadata.labels,
        ...params.body.metadata.labels,
      };
    }
    const spec = template?.spec;
    if (!spec) throw new SandboxAdmissionError("Sandbox Job is missing its Pod specification.");
    this.imagePullCredentials(spec);
    const pods = [spec];
    if (companionPodName) {
      try {
        const companion = await boundedK8sCall(
          this.coreApi.listNamespacedPod({
            namespace: params.namespace,
            fieldSelector: `metadata.name=${companionPodName}`,
          }),
          `sandbox companion ${companionPodName}`,
        );
        const spec = companion.items.find(
          (pod) => pod.metadata?.name === companionPodName,
        )?.spec;
        if (!spec) throw new Error("Companion Pod specification is unavailable.");
        pods.push(spec);
      } catch (error) {
        signal.throwIfAborted();
        throw new SandboxInfrastructureError(
          `Could not inspect companion ${companionPodName}.`,
          { cause: error },
        );
      }
    }
    await this.assertSandboxQuota(pods, params.namespace, signal);
    return this.batchApi.createNamespacedJob(params);
  }

  private async createSandboxPod(
    params: { namespace: string; body: k8s.V1Pod },
    signal: AbortSignal,
  ): Promise<k8s.V1Pod> {
    if (!params.body.spec)
      throw new SandboxAdmissionError("Sandbox service is missing its Pod specification.");
    params.body.metadata = this.runMetadata(params.body.metadata);
    this.imagePullCredentials(params.body.spec);
    await this.assertSandboxQuota([params.body.spec], params.namespace, signal);
    return this.coreApi.createNamespacedPod(params);
  }

  private async createStageJob(
    jobName: string,
    namespace: string,
    payloads: { run: string[]; judge: string[] },
    deadlineSeconds: number,
    request: SandboxRequest,
    runParallelism: number,
    runMemoryLimit: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const memoryLimit = resolveK8sMemoryLimit(request, this.config);
    await this.createSandboxJob(
      {
        namespace,
        body: buildStageJobManifest({
          jobName,
          namespace,
          runConfigMapNames: payloads.run,
          judgeConfigMapNames: payloads.judge,
          image: request.sandboxImage ?? this.config.image,
          cpuRequest: this.config.cpuRequest,
          cpuLimit: this.config.cpuLimit,
          memoryRequest: this.config.memoryRequest,
          compilerMemoryLimit: `${String(Math.max(parseMemoryLimitMb(memoryLimit), MIN_COMPILER_MEMORY_MB))}Mi`,
          runParallelism,
          runMemoryLimit,
          activeDeadlineSeconds: deadlineSeconds,
          ...(this.config.runtimeClassName
            ? { runtimeClassName: this.config.runtimeClassName }
            : {}),
        }),
      },
      signal,
    ).catch(rethrowSandboxQuotaError);
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

  private async jobEventBlockedReason(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    try {
      signal.throwIfAborted();
      const events = await this.coreApi.listNamespacedEvent({
        namespace,
        fieldSelector: `involvedObject.kind=Job,involvedObject.name=${jobName}`,
        limit: 50,
      });
      signal.throwIfAborted();
      return findFailedCreateEventReason(events.items);
    } catch {
      signal.throwIfAborted();
      return null;
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
    let watchReconnectAttempt = 0;

    while (Date.now() < deadline) {
      signal.throwIfAborted();

      let snapshot: JobWatchSnapshot;
      try {
        snapshot = await this.readJobWatchSnapshot(jobName, namespace, signal);
      } catch {
        signal.throwIfAborted();
        throw new SandboxInfrastructureError(
          `Sandbox Job ${jobName} status snapshot failed; retrying the sandbox run.`,
        );
      }

      if (!everStarted) {
        const eventBlockedReason = await this.jobEventBlockedReason(jobName, namespace, signal);
        if (eventBlockedReason && isDeterministicAdmissionFailure(eventBlockedReason)) {
          throw new SandboxAdmissionError(
            `Sandbox Job ${jobName} was rejected before pod creation: ${eventBlockedReason}`,
          );
        }
        if (
          snapshot.pods.length === 0 &&
          eventBlockedReason &&
          /exceeded quota/i.test(eventBlockedReason) &&
          Date.now() - startedAt >= POD_SCHEDULE_GRACE_MS
        ) {
          throw new SandboxBackpressureError(
            `Sandbox Job ${jobName} is waiting for capacity: ${eventBlockedReason}`,
          );
        }
      }

      const current = this.evaluateJobSnapshot(
        jobName,
        snapshot.job,
        snapshot.pods,
        everStarted,
        startedAt,
      );
      everStarted = current.everStarted;
      if (current.outcome) return current.outcome;

      const watched = await this.watchJobUntilChange({
        jobName,
        namespace,
        snapshot,
        everStarted,
        startedAt,
        deadline,
        signal,
      });
      everStarted = watched.everStarted;
      if (watched.outcome) return watched.outcome;

      await this.sleep(jobWatchReconnectDelay(watchReconnectAttempt), signal);
      watchReconnectAttempt += 1;
    }

    if (!everStarted) {
      throw new SandboxBackpressureError(
        `Sandbox Job ${jobName} produced no running pod before the deadline (quota/capacity backpressure); retrying with backoff.`,
      );
    }

    return { state: "failed", deadlineExceeded: true };
  }

  private async readJobWatchSnapshot(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<JobWatchSnapshot> {
    signal.throwIfAborted();
    const [job, pods] = await Promise.all([
      this.batchApi.readNamespacedJob({ name: jobName, namespace }),
      this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      }),
    ]);
    signal.throwIfAborted();
    return {
      job,
      pods: pods.items,
      ...(job.metadata?.resourceVersion
        ? { jobResourceVersion: job.metadata.resourceVersion }
        : {}),
      ...(pods.metadata?.resourceVersion
        ? { podResourceVersion: pods.metadata.resourceVersion }
        : {}),
    };
  }

  private evaluateJobSnapshot(
    jobName: string,
    job: k8s.V1Job,
    pods: k8s.V1Pod[],
    everStarted: boolean,
    startedAt: number,
  ): JobWatchEvaluation {
    if (job.status?.succeeded) {
      return { everStarted, outcome: { state: "succeeded", deadlineExceeded: false } };
    }

    const podState = summarizeJobPods(pods);
    if (podState.imagePull?.reason === "ImagePullBackOff") {
      throw new SandboxImagePullError(
        `Cannot pull image for Job ${jobName}: ${podState.imagePull.message}`,
      );
    }
    if (job.status?.failed) {
      const blockedReason = this.jobBlockedReason(job);
      if (blockedReason) {
        if (isDeterministicAdmissionFailure(blockedReason)) {
          throw new SandboxAdmissionError(
            `Sandbox Job ${jobName} was rejected before pod creation: ${blockedReason}`,
          );
        }
        throw new SandboxBackpressureError(
          `Sandbox Job ${jobName} could not create pods (${blockedReason}); retrying with backoff.`,
        );
      }
      const jobFailure = (job.status.conditions ?? [])
        .flatMap((condition) => [condition.reason, condition.message])
        .map(infrastructureFailureReason)
        .find((reason): reason is string => reason !== null);
      if (jobFailure) {
        throw new SandboxTransientInfrastructureError(
          `Sandbox Job ${jobName} was interrupted by infrastructure (${jobFailure}); retrying the sandbox run.`,
        );
      }
      if (podState.infrastructureFailure) {
        throw new SandboxTransientInfrastructureError(
          `Sandbox Job ${jobName} was interrupted by infrastructure (${podState.infrastructureFailure}); retrying the sandbox run.`,
        );
      }
      if (
        !everStarted &&
        !podState.everStarted &&
        (job.status.conditions ?? []).some(
          (condition) => condition.reason === "DeadlineExceeded",
        )
      ) {
        throw new SandboxBackpressureError(
          `Sandbox Job ${jobName} reached its deadline before starting; waiting for capacity.`,
        );
      }
      return {
        everStarted: everStarted || podState.everStarted,
        outcome: {
          state: "failed",
          deadlineExceeded: (job.status.conditions ?? []).some(
            (condition) => condition.reason === "DeadlineExceeded",
          ),
        },
      };
    }

    if (podState.succeeded) {
      return { everStarted: true, outcome: { state: "succeeded", deadlineExceeded: false } };
    }
    if (podState.infrastructureFailure) {
      throw new SandboxTransientInfrastructureError(
        `Sandbox Job ${jobName} was interrupted by infrastructure (${podState.infrastructureFailure}); retrying the sandbox run.`,
      );
    }

    const nextEverStarted = everStarted || podState.everStarted;
    if (!nextEverStarted && Date.now() - startedAt > POD_SCHEDULE_GRACE_MS) {
      const blockedReason = this.jobBlockedReason(job);
      if (blockedReason && isDeterministicAdmissionFailure(blockedReason)) {
        throw new SandboxAdmissionError(
          `Sandbox Job ${jobName} was rejected before pod creation: ${blockedReason}`,
        );
      }
      if (blockedReason || podState.unschedulableReason) {
        throw new SandboxBackpressureError(
          `Sandbox Job ${jobName} pod never scheduled (${blockedReason ?? podState.unschedulableReason ?? "quota/capacity"}); retrying with backoff.`,
        );
      }
    }

    return { everStarted: nextEverStarted, outcome: null };
  }

  private async watchJobUntilChange(params: {
    jobName: string;
    namespace: string;
    snapshot: JobWatchSnapshot;
    everStarted: boolean;
    startedAt: number;
    deadline: number;
    signal: AbortSignal;
  }): Promise<JobWatchEvaluation> {
    const { jobName, namespace, snapshot, startedAt, deadline, signal } = params;
    signal.throwIfAborted();
    let currentJob = snapshot.job;
    const pods = new Map(
      snapshot.pods
        .map((pod) => [pod.metadata?.name, pod] as const)
        .filter((entry): entry is [string, k8s.V1Pod] => entry[0] !== undefined),
    );
    let everStarted = params.everStarted;
    let settled = false;
    let resolveResult!: (value: JobWatchEvaluation) => void;
    let rejectResult!: (reason: unknown) => void;
    const controllers: AbortController[] = [];
    const timerHandles: ReturnType<typeof setTimeout>[] = [];

    const result = new Promise<JobWatchEvaluation>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const cleanup = () => {
      for (const timer of timerHandles) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      for (const controller of controllers) controller.abort();
    };
    const settle = (value: JobWatchEvaluation) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectResult(error);
    };
    const onAbort = () => fail(executionAbortReason(signal));
    const refresh = () => settle({ everStarted, outcome: null });
    const evaluate = () => {
      try {
        const evaluation = this.evaluateJobSnapshot(
          jobName,
          currentJob,
          [...pods.values()],
          everStarted,
          startedAt,
        );
        everStarted = evaluation.everStarted;
        if (evaluation.outcome) settle(evaluation);
      } catch (error) {
        fail(error);
      }
    };
    const watchFailure = (error: unknown) => {
      const code = watchErrorCode(error);
      if (error === null || code === 410) {
        refresh();
        return;
      }
      fail(
        error instanceof SandboxInfrastructureError
          ? error
          : new SandboxInfrastructureError(
              `Sandbox Job ${jobName} watch failed; retrying the sandbox run.`,
            ),
      );
    };
    const handleJobEvent = (phase: string, object: unknown) => {
      if (phase === "ERROR") {
        watchFailure(object);
        return;
      }
      if (phase === "BOOKMARK") return;
      if (phase === "DELETED") {
        fail(
          new SandboxInfrastructureError(`Sandbox Job ${jobName} disappeared while running.`),
        );
        return;
      }
      if (typeof object === "object" && object !== null) {
        currentJob = object;
        evaluate();
      }
    };
    const handlePodEvent = (phase: string, object: unknown) => {
      if (phase === "ERROR") {
        watchFailure(object);
        return;
      }
      if (phase === "BOOKMARK") return;
      if (typeof object !== "object" || object === null) return;
      const pod = object as k8s.V1Pod;
      const podName = pod.metadata?.name;
      if (!podName) return;
      if (phase === "DELETED") pods.delete(podName);
      else pods.set(podName, pod);
      evaluate();
    };
    const register = (controller: AbortController) => {
      if (settled) controller.abort();
      else controllers.push(controller);
    };
    const startWatch = async (
      path: string,
      queryParams: Record<string, string | number | boolean | undefined>,
      callback: (phase: string, object: unknown) => void,
    ) => {
      try {
        const controller = await this.watchClient.watch(
          path,
          queryParams,
          callback,
          watchFailure,
        );
        register(controller);
      } catch (error) {
        watchFailure(error);
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return result;
    }
    const remainingSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1_000));
    timerHandles.push(
      setTimeout(refresh, Math.min(JOB_WATCH_TIMEOUT_SECONDS, remainingSeconds) * 1_000),
    );
    if (!everStarted) {
      const scheduleDelay = POD_SCHEDULE_GRACE_MS - (Date.now() - startedAt);
      if (scheduleDelay > 0) timerHandles.push(setTimeout(refresh, scheduleDelay));
    }

    void Promise.all([
      startWatch(
        `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`,
        {
          fieldSelector: `metadata.name=${jobName}`,
          resourceVersion: snapshot.jobResourceVersion,
          allowWatchBookmarks: true,
          timeoutSeconds: Math.min(JOB_WATCH_TIMEOUT_SECONDS, remainingSeconds),
        },
        handleJobEvent,
      ),
      startWatch(
        `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`,
        {
          labelSelector: `job-name=${jobName}`,
          resourceVersion: snapshot.podResourceVersion,
          allowWatchBookmarks: true,
          timeoutSeconds: Math.min(JOB_WATCH_TIMEOUT_SECONDS, remainingSeconds),
        },
        handlePodEvent,
      ),
    ]);

    return result;
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
    const podName = await this.findPodName(jobName, namespace, signal);
    if (!podName) {
      throw new Error(`No pod found for job ${jobName}`);
    }

    return this.getPodContainerLogs(podName, namespace, container, signal);
  }

  private async getPodContainerLogs(
    podName: string,
    namespace: string,
    container: string,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    try {
      const logs = await this.coreApi.readNamespacedPodLog({
        container,
        name: podName,
        namespace,
      });
      signal.throwIfAborted();
      return logs;
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not read sandbox logs for ${namespace}/${podName} (${container}): ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
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

  private async cleanup(
    jobName: string,
    namespace: string,
    payloadNames: string[],
  ): Promise<void> {
    const budget = new SandboxCleanupBudget();
    await this.cleanupJob(jobName, namespace, budget);
    await runCleanupOperations(
      "sandbox",
      payloadNames.map(async (name) => {
        try {
          await budget.call(`ConfigMap ${namespace}/${name}`, () =>
            this.coreApi.deleteNamespacedConfigMap({ name, namespace }),
          );
        } catch (error) {
          if (!isK8sNotFound(error)) throw error;
        }
      }),
    );
  }
}
