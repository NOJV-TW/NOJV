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

export async function measurePhase<T>(
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

export class KubernetesExecutionObserver {
  constructor(private readonly coreApi: k8s.CoreV1Api) {}

  async observeJobLifecycle(
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

  private async firstJobPod(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
    failure: string,
  ): Promise<k8s.V1Pod | undefined> {
    try {
      signal.throwIfAborted();
      const pods = await this.coreApi.listNamespacedPod({
        namespace,
        labelSelector: `job-name=${jobName}`,
      });
      signal.throwIfAborted();
      return pods.items[0];
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `${failure} for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async findPodName(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
      signal,
      "Could not find sandbox pod",
    );
    return pod?.metadata?.name ?? null;
  }

  async inspectRunPod(
    jobName: string,
    namespace: string,
    signal: AbortSignal,
  ): Promise<{ nodeName: string | null; transferCaptureOk: boolean }> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
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
    signal: AbortSignal,
  ): Promise<{ name: string; runStarted: boolean; judgeStarted: boolean } | null> {
    const pod = await this.firstJobPod(
      jobName,
      namespace,
      signal,
      "Could not find sandbox pod",
    );
    const name = pod?.metadata?.name;
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
