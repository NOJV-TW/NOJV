import type * as k8s from "@kubernetes/client-node";

import { executionAbortReason } from "../shared/execution-abort";
import { findFailedCreateEventReason, isDeterministicAdmissionFailure } from "./admission";
import {
  SandboxAdmissionError,
  SandboxBackpressureError,
  SandboxImagePullError,
  SandboxInfrastructureError,
  SandboxTransientInfrastructureError,
} from "./errors";
import { infrastructureFailureReason, summarizeJobPods } from "./job-state";

const JOB_DEADLINE_BUFFER_SECONDS = 60;
const POD_SCHEDULE_GRACE_MS = 30_000;
const JOB_WATCH_TIMEOUT_SECONDS = 30;
const JOB_WATCH_RECONNECT_BASE_DELAY_MS = 100;
const JOB_WATCH_RECONNECT_MAX_DELAY_MS = 2_000;

function jobWatchReconnectDelay(attempt: number): number {
  return Math.min(
    JOB_WATCH_RECONNECT_MAX_DELAY_MS,
    JOB_WATCH_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 5),
  );
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

export class KubernetesJobWatcher {
  constructor(
    private readonly coreApi: k8s.CoreV1Api,
    private readonly batchApi: k8s.BatchV1Api,
    private readonly watchClient: K8sWatchClient,
  ) {}

  async waitForJobCompletion(
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

  async waitForJobOutcome(
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
