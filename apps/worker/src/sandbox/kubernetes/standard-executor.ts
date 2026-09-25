import {
  DEFAULT_MAX_MEMORY_MB,
  MIN_COMPILER_MEMORY_MB,
  type SandboxExecutionContext,
  type SandboxRequest,
  type SandboxResult,
} from "@nojv/core";

import { createLogger } from "../../logger.js";
import { recordJudgePhase, recordRunnerResources } from "../shared/judge-phase-metrics";
import { measurePhase, requestMode } from "./execution-observer";
import { runCleanupAfterExecution } from "./cleanup";
import { parseMemoryLimitMb, resolveK8sMemoryLimit } from "./resource-capacity";
import { computeStageJobDeadlineSeconds } from "./job-deadlines";
import { buildJudgePayload, buildRunPayload } from "../shared/stage-payload";
import {
  completeRuns,
  gradableRuns,
  mergeStageResults,
  parseCompilationError,
  parseJudgeOutcomes,
  parseRunResult,
} from "../shared/stage-result";
import { JUDGE_CONTAINER_NAME, RUN_CONTAINER_NAME } from "./job-manifests";
import type { K8sExecutorConfig } from "./executor.js";
import type { KubernetesExecutionObserver } from "./execution-observer";
import type { KubernetesJobWatcher } from "./job-watch";
import type { KubernetesSandboxCleanup } from "./resource-cleanup";
import type { KubernetesSandboxResources } from "./resources";

const logger = createLogger("k8s-executor");
const RUNNER_MEMORY_MB = 128;

export class KubernetesStandardExecutor {
  constructor(
    private readonly config: K8sExecutorConfig,
    private readonly jobWatcher: KubernetesJobWatcher,
    private readonly resources: KubernetesSandboxResources,
    private readonly cleanupResources: KubernetesSandboxCleanup,
    private readonly observer: KubernetesExecutionObserver,
  ) {}

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
        buildRunPayload(request, parallelism),
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

  async execute(
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
      await this.observer.observeJobLifecycle(jobName, ns, request);

      const pod = await this.observer.findStagePod(jobName, ns, execution.signal);
      if (!pod) throw new Error(`No pod found for job ${jobName}`);
      const [runLog, judgeLog] = await Promise.all([
        pod.runStarted
          ? this.observer.getPodContainerLogs(
              pod.name,
              ns,
              RUN_CONTAINER_NAME,
              execution.signal,
            )
          : "",
        pod.judgeStarted
          ? this.observer.getPodContainerLogs(
              pod.name,
              ns,
              JUDGE_CONTAINER_NAME,
              execution.signal,
            )
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
        await measurePhase(request, "cleanup", () =>
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
}
