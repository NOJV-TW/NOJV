import type * as k8s from "@kubernetes/client-node";

import { failureMessage, k8sErrorCode } from "./cleanup-call";
import { SandboxBackpressureError } from "./errors";

export function findFailedCreateEventReason(events: readonly k8s.CoreV1Event[]): string | null {
  const event = events.find(
    (candidate) => candidate.type === "Warning" && candidate.reason === "FailedCreate",
  );
  if (!event) return null;
  return `${event.reason ?? "FailedCreate"}: ${event.message ?? "Kubernetes rejected pod creation."}`;
}

export function isDeterministicAdmissionFailure(reason: string): boolean {
  if (/exceeded quota/i.test(reason)) return false;
  return /forbidden|limit range|maximum .*memory|must be less|invalid.*(?:memory|cpu)/i.test(
    reason,
  );
}

export function rethrowSandboxQuotaError(error: unknown): never {
  const message =
    typeof error === "object" && error !== null && "body" in error
      ? failureMessage(error.body)
      : failureMessage(error);
  if (k8sErrorCode(error) === 403 && /exceeded quota/i.test(message)) {
    throw new SandboxBackpressureError(
      `Sandbox resource creation is waiting for capacity: ${message}`,
    );
  }
  throw error;
}
