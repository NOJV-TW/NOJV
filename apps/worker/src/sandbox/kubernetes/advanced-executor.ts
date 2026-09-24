import type * as k8s from "@kubernetes/client-node";

import {
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
  type SandboxExecutionContext,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";
import { createLogger } from "../../logger.js";
import { executionAbortReason } from "../shared/execution-abort";
import { advancedFallbackResult, mapAdvancedResult } from "../shared/sandbox-result-mapper";
import { sandboxSystemError } from "../shared/sandbox-plan";
import { recordRunnerResources } from "../shared/judge-phase-metrics";
import {
  buildAdvancedConfigMapData,
  advancedPvcName,
  buildAdvancedGradeConfigMapData,
  buildAdvancedGradeJobManifest,
  buildAdvancedRunJobManifest,
  deriveRunStatusFromJob,
  parseAdvancedResultLog,
  ADVANCED_SIDECAR_NAME,
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
import {
  SandboxAdmissionError,
  SandboxBackpressureError,
  SandboxImagePullError,
  SandboxInfrastructureError,
  SandboxTransientInfrastructureError,
} from "./errors";
import { SandboxCleanupBudget, isK8sNotFound } from "./termination";
import { rethrowSandboxQuotaError } from "./admission";
import { runCleanupAfterExecution, throwCleanupFailures } from "./cleanup";
import { measurePhase } from "./execution-observer";
import { summarizeJobPods } from "./job-state";
import type { K8sExecutorConfig } from "./executor.js";
import type { KubernetesExecutionObserver } from "./execution-observer";
import type { KubernetesJobWatcher } from "./job-watch";
import type { KubernetesSandboxCleanup } from "./resource-cleanup";
import type { KubernetesSandboxResources } from "./resources";

const logger = createLogger("k8s-executor");
const SIDECAR_READINESS_TIMEOUT_MS = 30_000;
const SIDECAR_READINESS_INTERVAL_MS = 500;

interface AdvancedExecutionContext {
  request: SandboxRequest;
  execution: SandboxExecutionContext;
  advanced: NonNullable<SandboxRequest["advanced"]>;
  resourceId: string;
  pvcName: string;
  deadlineSeconds: number;
  hasSidecar: boolean;
}

interface AdvancedRunPhaseInput extends AdvancedExecutionContext {
  jobName: string;
  configMapName: string;
  runExtraEnv?: Record<string, string>;
}

interface AdvancedGradePhaseInput extends AdvancedExecutionContext {
  jobName: string;
  configMapName: string;
  nodeName: string;
  runStatus: ReturnType<typeof deriveRunStatusFromJob>;
}

type AdvancedRunPhaseResult =
  | { kind: "fallback"; result: SandboxResult }
  | {
      kind: "ready";
      nodeName: string;
      runStatus: ReturnType<typeof deriveRunStatusFromJob>;
    };

export class KubernetesAdvancedExecutor {
  constructor(
    private readonly config: K8sExecutorConfig,
    private readonly coreApi: k8s.CoreV1Api,
    private readonly jobWatcher: KubernetesJobWatcher,
    private readonly resources: KubernetesSandboxResources,
    private readonly cleanupResources: KubernetesSandboxCleanup,
    private readonly observer: KubernetesExecutionObserver,
  ) {}

  async execute(
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

      const context: AdvancedExecutionContext = {
        request,
        execution,
        advanced,
        resourceId,
        pvcName,
        deadlineSeconds,
        hasSidecar,
      };
      const run = await this.executeRunPhase({
        ...context,
        jobName: runJobName,
        configMapName: runConfigMapName,
        ...(runExtraEnv ? { runExtraEnv } : {}),
      });
      if (run.kind === "fallback") return run.result;

      return await this.executeGradePhase({
        ...context,
        jobName: gradeJobName,
        configMapName: gradeConfigMapName,
        nodeName: run.nodeName,
        runStatus: run.runStatus,
      });
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
      await measurePhase(request, "cleanup", () =>
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

  private async executeRunPhase({
    request,
    execution,
    advanced,
    resourceId,
    pvcName,
    deadlineSeconds,
    hasSidecar,
    jobName,
    configMapName,
    runExtraEnv,
  }: AdvancedRunPhaseInput): Promise<AdvancedRunPhaseResult> {
    const ns = this.config.namespace;
    await this.resources
      .createSandboxJob(
        {
          namespace: ns,
          body: buildAdvancedRunJobManifest({
            jobName,
            namespace: ns,
            configMapName,
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

    const outcome = await this.jobWatcher.waitForJobOutcome(
      jobName,
      ns,
      deadlineSeconds,
      execution.signal,
    );
    await this.observer.observeJobLifecycle(jobName, ns, request);
    const { nodeName, transferCaptureOk } = await this.observer.inspectRunPod(
      jobName,
      ns,
      execution.signal,
    );
    if (!nodeName) {
      return {
        kind: "fallback",
        result: advancedFallbackResult(
          request,
          "Advanced run phase produced no scheduled pod.",
        ),
      };
    }
    if (!outcome.deadlineExceeded && !transferCaptureOk) {
      return {
        kind: "fallback",
        result: advancedFallbackResult(
          request,
          "Advanced run output capture failed (size/file cap or IO error).",
        ),
      };
    }

    const runStatus = deriveRunStatusFromJob(outcome.state, outcome.deadlineExceeded);
    await measurePhase(request, "cleanup", () =>
      this.cleanupResources.cleanupAdvancedJob(jobName, ns),
    );
    return { kind: "ready", nodeName, runStatus };
  }

  private async executeGradePhase({
    request,
    execution,
    advanced,
    resourceId,
    pvcName,
    deadlineSeconds,
    hasSidecar,
    jobName,
    configMapName,
    nodeName,
    runStatus,
  }: AdvancedGradePhaseInput): Promise<SandboxResult> {
    const ns = this.config.namespace;
    await this.resources.createConfigMap(
      configMapName,
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
            jobName,
            namespace: ns,
            configMapName,
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

    await this.jobWatcher.waitForJobCompletion(jobName, ns, deadlineSeconds, execution.signal);
    await this.observer.observeJobLifecycle(jobName, ns, request);
    const podName = await this.observer.findPodName(jobName, ns, execution.signal);
    if (!podName)
      return advancedFallbackResult(request, "Advanced grade phase produced no pod.");

    const sidecarLog = await measurePhase(request, "collect", () =>
      this.observer.getPodContainerLogs(podName, ns, ADVANCED_SIDECAR_NAME, execution.signal),
    );
    recordRunnerResources(sidecarLog, "advanced", request.language, "checker", {
      jobName,
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
      return advancedFallbackResult(request, `Invalid result.json: ${resultIssues.join(", ")}`);
    }
    return mapAdvancedResult(request, parsed.data);
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
        const log = await this.observer.getPodContainerLogs(podName, ns, "service", signal);
        if (log.includes(marker)) return true;
      }
      await this.observer.sleep(intervalMs, signal);
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
    await this.cleanupResources
      .networkingApi()
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
    const networkingApi = this.cleanupResources.networkingApi();
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
}
