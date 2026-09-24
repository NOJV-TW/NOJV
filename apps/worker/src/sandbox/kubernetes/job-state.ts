import type * as k8s from "@kubernetes/client-node";

export function infrastructureFailureReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^(Evicted|Shutdown|NodeShutdown|NodeLost|Preempted|DisruptionTarget)$/i.test(value) ||
    /(?:node (?:was )?(?:lost|shutdown|shutting down)|spot interruption|preempted|evicted)/i.test(
      value,
    )
    ? value
    : null;
}

interface JobPodSummary {
  everStarted: boolean;
  unschedulableReason: string | null;
  succeeded: boolean;
  imagePull: { reason: string; message: string } | null;
  infrastructureFailure: string | null;
}

export function summarizeJobPods(pods: k8s.V1Pod[]): JobPodSummary {
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
