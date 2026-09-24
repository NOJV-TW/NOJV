import type * as k8s from "@kubernetes/client-node";

import type { SandboxRequest } from "@nojv/core";

import { createLogger } from "../../logger.js";
import { executionAbortReason } from "../shared/execution-abort";
import {
  podPhaseTimings,
  recordCleanupPending,
  recordJudgePhase,
  type JudgePhase,
  type JudgeMode,
} from "../shared/judge-phase-metrics";
import { failureMessage } from "./cleanup-call";
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

  async findPodName(
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

  async inspectRunPod(
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
        (container) => container.name === ADVANCED_TRANSFER_NAME,
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

  async findStagePod(
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
    } catch (error) {
      signal.throwIfAborted();
      throw new SandboxInfrastructureError(
        `Could not find sandbox pod for ${namespace}/${jobName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
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

  sleep(ms: number, signal: AbortSignal): Promise<void> {
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
