import { failureMessage } from "./cleanup-call";
import { createRequire } from "node:module";
import {
  podPhaseTimings,
  recordJudgePhase,
  recordCleanupPending,
  recordRunnerResources,
  type JudgePhase,
  type JudgeMode,
} from "../shared/judge-phase-metrics";
import { SandboxCleanupBudget, isK8sNotFound } from "./termination";
import { summarizeJobPods } from "./job-state";
import { KubernetesJobWatcher, type K8sWatchClient } from "./job-watch";
import { KubernetesSandboxCleanup } from "./resource-cleanup";
import { KubernetesSandboxResources } from "./resources";
import {
  SandboxAdmissionError,
  SandboxBackpressureError,
  SandboxImagePullError,
  SandboxInfrastructureError,
  SandboxTransientInfrastructureError,
} from "./errors";
import { rethrowSandboxQuotaError } from "./admission";
import { runCleanupAfterExecution, throwCleanupFailures } from "./cleanup";
import { parseMemoryLimitMb, resolveK8sMemoryLimit } from "./resource-capacity";

import type * as k8s from "@kubernetes/client-node";

const require = createRequire(import.meta.url);

import {
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
  DEFAULT_MAX_MEMORY_MB,
  MIN_COMPILER_MEMORY_MB,
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
} from "./configmaps";
import {
  buildInteractiveJobManifest,
  JUDGE_CONTAINER_NAME,
  RUN_CONTAINER_NAME,
} from "./job-manifests";
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

const SIDECAR_READINESS_TIMEOUT_MS = 30_000;
const SIDECAR_READINESS_INTERVAL_MS = 500;

const RUNNER_MEMORY_MB = 128;

export interface K8sClientHandles {
  coreApi: k8s.CoreV1Api;
  batchApi: k8s.BatchV1Api;
  networkingApi?: k8s.NetworkingV1Api;
  watch: K8sWatchClient;
}

function requestMode(request: SandboxRequest): JudgeMode {
  return request.advanced ? "advanced" : request.judgeType;
}

export class K8sExecutor implements SandboxExecutor {
  private readonly coreApi: k8s.CoreV1Api;
  private readonly batchApi: k8s.BatchV1Api;
  private readonly jobWatcher: KubernetesJobWatcher;
  private readonly resources: KubernetesSandboxResources;
  private readonly cleanupResources: KubernetesSandboxCleanup;

  constructor(
    private readonly config: K8sExecutorConfig,
    clients?: K8sClientHandles,
  ) {
    if (clients) {
      this.coreApi = clients.coreApi;
      this.batchApi = clients.batchApi;
      this.jobWatcher = new KubernetesJobWatcher(this.coreApi, this.batchApi, clients.watch);
      this.resources = new KubernetesSandboxResources(config, this.coreApi, this.batchApi);
      this.cleanupResources = new KubernetesSandboxCleanup(
        config.namespace,
        this.coreApi,
        this.batchApi,
        clients.networkingApi,
      );
      return;
    }
    const k8sLib = require("@kubernetes/client-node") as typeof k8s;
    const kc = new k8sLib.KubeConfig();
    kc.loadFromCluster();
    this.coreApi = kc.makeApiClient(k8sLib.CoreV1Api);
    this.batchApi = kc.makeApiClient(k8sLib.BatchV1Api);
    const networkingApi = kc.makeApiClient(k8sLib.NetworkingV1Api);
    this.jobWatcher = new KubernetesJobWatcher(
      this.coreApi,
      this.batchApi,
      new k8sLib.Watch(kc),
    );
    this.resources = new KubernetesSandboxResources(config, this.coreApi, this.batchApi);
    this.cleanupResources = new KubernetesSandboxCleanup(
      config.namespace,
      this.coreApi,
      this.batchApi,
      networkingApi,
    );
  }

  async cleanupRun(runId: string): Promise<void> {
    return this.cleanupResources.cleanupRun(runId);
  }

  async reconcile(runId: string, owner?: string): Promise<boolean> {
    return this.cleanupResources.reconcile(runId, owner);
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

  private networkingApi(): k8s.NetworkingV1Api {
    return this.cleanupResources.networkingApi();
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
      await this.resources.createPvc(pvcName, ns, execution.signal);
      await this.resources.createConfigMap(
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

      await this.resources
        .createSandboxJob(
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
        )
        .catch(rethrowSandboxQuotaError);
      execution.signal.throwIfAborted();

      const runOutcome = await this.jobWatcher.waitForJobOutcome(
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
        this.cleanupResources.cleanupAdvancedJob(runJobName, ns),
      );

      await this.resources.createConfigMap(
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
      await this.resources
        .createSandboxJob(
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
        )
        .catch(rethrowSandboxQuotaError);
      execution.signal.throwIfAborted();

      await this.jobWatcher.waitForJobCompletion(
        gradeJobName,
        ns,
        deadlineSeconds,
        execution.signal,
      );
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
            this.cleanupResources.cleanupAdvancedJob(runJobName, ns, budget),
            this.cleanupResources.cleanupAdvancedJob(gradeJobName, ns, budget),
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
            this.cleanupResources.cleanupConfigMap(runConfigMapName, ns, budget),
            this.cleanupResources.cleanupConfigMap(gradeConfigMapName, ns, budget),
            this.cleanupResources.cleanupPvc(pvcName, ns, budget),
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
    await this.resources
      .createSandboxPod(
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
      )
      .catch(rethrowSandboxQuotaError);
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
    if (hasSidecar)
      await this.cleanupResources.cleanupAdvancedPod(sidecarPodName(submissionId), ns, budget);
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
      solutionPayloadNames = await this.resources.createPayloadConfigMaps(
        solConfigMap,
        namespace,
        buildInteractiveSolutionConfigMapData(request),
        signal,
        (name, ns) => this.cleanupResources.cleanupConfigMap(name, ns),
      );
      interactorPayloadNames = await this.resources.createPayloadConfigMaps(
        intConfigMap,
        namespace,
        buildInteractiveInteractorConfigMapData(request),
        signal,
        (name, ns) => this.cleanupResources.cleanupConfigMap(name, ns),
      );

      const deadlineSeconds = computeInteractiveJobDeadlineSeconds(request);
      await this.resources
        .createSandboxJob(
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
        )
        .catch(rethrowSandboxQuotaError);
      signal.throwIfAborted();

      const outcome = await this.jobWatcher.waitForJobOutcome(
        jobName,
        namespace,
        deadlineSeconds,
        signal,
      );
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
          this.cleanupResources.cleanup(jobName, namespace, [
            ...solutionPayloadNames,
            ...interactorPayloadNames,
          ]),
        ),
      );
    }
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
      this.resources.createPayloadConfigMaps(
        `${jobName}-run`,
        namespace,
        buildRunConfigMapData(request, parallelism),
        signal,
        (name, ns) => this.cleanupResources.cleanupConfigMap(name, ns),
      ),
      this.resources.createPayloadConfigMaps(
        `${jobName}-judge`,
        namespace,
        buildJudgePayload(request),
        signal,
        (name, ns) => this.cleanupResources.cleanupConfigMap(name, ns),
      ),
    ]);
    if (run.status === "fulfilled" && judge.status === "fulfilled")
      return { run: run.value, judge: judge.value };
    const created = [run, judge].flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    await Promise.allSettled(
      created.map((name) => this.cleanupResources.cleanupConfigMap(name, namespace)),
    );
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
      await this.resources.createStageJob(
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

      await this.jobWatcher.waitForJobCompletion(
        jobName,
        ns,
        deadlineSeconds,
        execution.signal,
      );
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
            this.cleanupResources.cleanup(jobName, ns, payloadNames),
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
}
