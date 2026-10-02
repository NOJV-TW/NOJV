import type * as k8s from "@kubernetes/client-node";

import type { SandboxRequest } from "@nojv/core";

import { createLogger } from "../../logger.js";
import {
  podPhaseTimings,
  recordCleanupPending,
  recordJudgePhase,
  type JudgePhase,
  type JudgeMode,
} from "../shared/judge-phase-metrics";
import { failureMessage } from "../shared/failure-message";
import { SandboxInfrastructureError } from "./errors";
import { ADVANCED_TRANSFER_NAME } from "./advanced";
import { JUDGE_CONTAINER_NAME, RUN_CONTAINER_NAME } from "./job-manifests";

const logger = createLogger("k8s-executor");

export function requestMode(request: SandboxRequest): JudgeMode {
  return request.advanced ? "advanced" : request.judgeType;
}

export function measurePhase<T>(
  request: SandboxRequest,
  phase: "collect" | "cleanup",
  operation: () => Promise<T>,
): Promise<T> {
  return measureLabeledPhase(requestMode(request), request.language, phase, operation);
}

export async function measureLabeledPhase<T>(
  mode: JudgeMode,
  language: SandboxRequest["language"],
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
      mode,
      language,
      success ? "success" : "failure",
    );
    if (!success && phase === "cleanup") recordCleanupPending(mode, language);
  }
}

export interface StagePod {
  name: string;
  runStarted: boolean;
  judgeStarted: boolean;
}

export function stagePod(pod: k8s.V1Pod): StagePod | null {
  const name = pod.metadata?.name;
  if (!name) return null;
  const started = (status: k8s.V1ContainerStatus | undefined) =>
    Boolean(status?.state?.terminated ?? status?.state?.running);
  return {
    name,
    runStarted: started(
      pod.status?.initContainerStatuses?.find(
        (container) => container.name === RUN_CONTAINER_NAME,
      ),
    ),
    judgeStarted: started(
      pod.status?.containerStatuses?.find(
        (container) => container.name === JUDGE_CONTAINER_NAME,
      ),
    ),
  };
}

export class KubernetesExecutionObserver {
  constructor(private readonly coreApi: k8s.CoreV1Api) {}

  private recordJobLifecycle(
    jobName: string,
    pods: k8s.V1Pod[],
    request: SandboxRequest,
  ): void {
    try {
      for (const pod of pods) {
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

  private async firstJobPod(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    signal: AbortSignal,
    failure: string,
  ): Promise<k8s.V1Pod | undefined> {
    let pods: k8s.V1PodList;
    try {
      signal.throwIfAborted();
      pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `${failure} for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    this.recordJobLifecycle(jobName, pods.items, request);
    return pods.items[0];
  }

  async findPodName(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    signal: AbortSignal,
  ): Promise<string | null> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
      request,
      signal,
      "Could not find sandbox pod",
    );
    return pod?.metadata?.name ?? null;
  }

  async inspectRunPod(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    signal: AbortSignal,
  ): Promise<{ nodeName: string | null; transferCaptureOk: boolean }> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
      request,
      signal,
      "Could not inspect sandbox pod",
    );
    const transferStatus = (pod?.status?.initContainerStatuses ?? []).find(
      (container) => container.name === ADVANCED_TRANSFER_NAME,
    );
    return {
      nodeName: pod?.spec?.nodeName ?? null,
      transferCaptureOk: transferStatus?.state?.terminated?.exitCode === 0,
    };
  }

  async findStagePod(
    jobName: string,
    namespace: string,
    request: SandboxRequest,
    signal: AbortSignal,
  ): Promise<StagePod | null> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
      request,
      signal,
      "Could not find sandbox pod",
    );
    return pod ? stagePod(pod) : null;
  }

  observedPod(jobName: string, pod: k8s.V1Pod, request: SandboxRequest): k8s.V1Pod {
    this.recordJobLifecycle(jobName, [pod], request);
    return pod;
  }

  async getPodContainerLogs(
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
}
