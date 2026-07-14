export interface LifecycleScheduleIdentity {
  scheduleRevision: number;
  timerFingerprint: string;
}

export interface ObservedLifecycleRun extends LifecycleScheduleIdentity {
  runId: string;
  status: string;
}

export type LifecycleReconciliationMode = "ensure" | "replace" | "cancel";
export type LifecycleReconciliationDecision =
  "keep" | "start" | "terminate" | "terminate-and-start";

interface LifecycleIncarnation {
  createdAtMs: bigint;
  scope: string;
}

function lifecycleIncarnation(timerFingerprint: string): LifecycleIncarnation | null {
  const [kind, version, entityId, createdAt, ...timerParts] = timerFingerprint.split(":");
  if (!kind || version !== "v1" || !entityId || !createdAt || timerParts.length === 0) {
    return null;
  }
  try {
    return { createdAtMs: BigInt(createdAt), scope: `${kind}:${version}:${entityId}` };
  } catch {
    return null;
  }
}

export function decideLifecycleReconciliation(
  mode: LifecycleReconciliationMode,
  desired: LifecycleScheduleIdentity,
  observed: ObservedLifecycleRun | null,
): LifecycleReconciliationDecision {
  if (!observed) return mode === "cancel" ? "keep" : "start";
  const desiredIncarnation = lifecycleIncarnation(desired.timerFingerprint);
  const observedIncarnation = lifecycleIncarnation(observed.timerFingerprint);
  if (
    desiredIncarnation !== null &&
    observedIncarnation !== null &&
    desiredIncarnation.scope === observedIncarnation.scope &&
    desiredIncarnation.createdAtMs !== observedIncarnation.createdAtMs
  ) {
    if (observedIncarnation.createdAtMs > desiredIncarnation.createdAtMs) return "keep";
    if (mode === "cancel") return observed.status === "RUNNING" ? "terminate" : "keep";
    return observed.status === "RUNNING" ? "terminate-and-start" : "start";
  }
  if (observed.scheduleRevision > desired.scheduleRevision) return "keep";

  if (mode === "cancel") {
    if (observed.status !== "RUNNING") return "keep";
    if (observed.scheduleRevision < 0) return "terminate";
    return observed.timerFingerprint === desired.timerFingerprint ||
      (desiredIncarnation !== null &&
        observedIncarnation !== null &&
        desiredIncarnation.scope === observedIncarnation.scope &&
        desiredIncarnation.createdAtMs === observedIncarnation.createdAtMs)
      ? "terminate"
      : "keep";
  }

  if (
    observed.timerFingerprint === desired.timerFingerprint &&
    (observed.status === "RUNNING" || observed.status === "COMPLETED")
  ) {
    return "keep";
  }

  return observed.status === "RUNNING" ? "terminate-and-start" : "start";
}
