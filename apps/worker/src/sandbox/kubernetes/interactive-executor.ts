import type { SandboxExecutionContext, SandboxRequest, SandboxResult } from "@nojv/core";

import { createLogger } from "../../logger.js";
import {
  resolveInteractiveStage,
  type InteractiveSideResult,
} from "../shared/check-interactive";
import { executionAbortReason } from "../shared/execution-abort";
import { sandboxSystemError } from "../shared/sandbox-plan";
import { recordRunnerResources } from "../shared/judge-phase-metrics";
import {
  buildInteractiveInteractorPayload,
  buildInteractiveSolutionPayload,
} from "../shared/stage-payload";
import { computeInteractiveJobDeadlineSeconds } from "./job-deadlines";
import { buildInteractiveJobManifest } from "./job-manifests";
import {
  SandboxAdmissionError,
  SandboxBackpressureError,
  SandboxImagePullError,
  SandboxInfrastructureError,
} from "./errors";
import { rethrowSandboxQuotaError } from "./admission";
import { runCleanupAfterExecution } from "./cleanup";
import { measurePhase } from "./execution-observer";
import { resolveK8sMemoryLimit } from "./resource-capacity";
import type { K8sExecutorConfig } from "./executor.js";
import type { KubernetesExecutionObserver } from "./execution-observer";
import type { KubernetesJobWatcher } from "./job-watch";
import type { KubernetesSandboxCleanup } from "./resource-cleanup";
import type { KubernetesSandboxResources } from "./resources";

const logger = createLogger("k8s-executor");

export class KubernetesInteractiveExecutor {
  constructor(
    private readonly config: K8sExecutorConfig,
    private readonly jobWatcher: KubernetesJobWatcher,
    private readonly resources: KubernetesSandboxResources,
    private readonly cleanupResources: KubernetesSandboxCleanup,
    private readonly observer: KubernetesExecutionObserver,
  ) {}

  async execute(
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
        buildInteractiveSolutionPayload(request),
        signal,
        (name, ns) => this.cleanupResources.cleanupConfigMap(name, ns),
      );
      interactorPayloadNames = await this.resources.createPayloadConfigMaps(
        intConfigMap,
        namespace,
        buildInteractiveInteractorPayload(request),
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
      await this.observer.observeJobLifecycle(jobName, namespace, request);
      const podName = await this.observer.findPodName(jobName, namespace, signal);
      if (!podName) {
        if (outcome.state === "failed") {
          return seCase("Interactive sandbox job failed or timed out.");
        }
        return seCase("Interactive sandbox produced no pod.");
      }

      const [solLogs, intLogs] = await measurePhase(request, "collect", () =>
        Promise.all([
          this.observer.getPodContainerLogs(podName, namespace, "solution", signal),
          this.observer.getPodContainerLogs(podName, namespace, "interactor", signal),
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
      await measurePhase(request, "cleanup", () =>
        runCleanupAfterExecution(executionFailure, () =>
          this.cleanupResources.cleanup(jobName, namespace, [
            ...solutionPayloadNames,
            ...interactorPayloadNames,
          ]),
        ),
      );
    }
  }
}
