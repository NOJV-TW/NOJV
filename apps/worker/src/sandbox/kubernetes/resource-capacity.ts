import type * as k8s from "@kubernetes/client-node";
import { findSuffix, quantityToScalar } from "@kubernetes/client-node/dist/util.js";

import {
  DEFAULT_MAX_MEMORY_MB,
  DEFAULT_MEMORY_HEADROOM_MB,
  resolveContainerMemoryMb,
  type SandboxRequest,
} from "@nojv/core";

export function parseMemoryLimitMb(value: string): number {
  return Number.parseInt(value, 10);
}

export function resolveK8sMemoryLimit(
  request: SandboxRequest,
  config: { memoryLimit: string; headroomMb?: number; maxMemoryMb?: number },
): string {
  const memoryMb = resolveContainerMemoryMb(request.limits.memoryMb, {
    defaultMemoryMb: parseMemoryLimitMb(config.memoryLimit),
    headroomMb: config.headroomMb ?? DEFAULT_MEMORY_HEADROOM_MB,
    maxMemoryMb: config.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB,
  });
  return `${String(memoryMb)}Mi`;
}

function quotaQuantity(quantity: string): number {
  const suffix = findSuffix(quantity);
  const value = suffix
    ? Number(quantity.slice(0, -suffix.length)) * Number(quantityToScalar(`1${suffix}`))
    : Number(quantityToScalar(quantity));
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`Invalid resource quantity: ${quantity}`);
  return value;
}

function podResourceRequirement(
  spec: k8s.V1PodSpec,
  field: "requests" | "limits",
  resource: "cpu" | "memory",
): number | null {
  const podLevel = spec.resources?.[field]?.[resource];
  const containers = [...spec.containers, ...(spec.initContainers ?? [])];
  if (
    field === "limits" &&
    podLevel === undefined &&
    containers.some((container) => container.resources?.limits?.[resource] === undefined)
  )
    return null;
  // Omitted requests are a lower bound: admission may supply LimitRange defaults.
  const amount = (container: k8s.V1Container) =>
    quotaQuantity(container.resources?.[field]?.[resource] ?? "0");
  let regular = spec.containers.reduce((total, container) => total + amount(container), 0);
  let restartable = 0;
  let initPeak = 0;
  for (const container of spec.initContainers ?? []) {
    const own = amount(container);
    if (container.restartPolicy === "Always") {
      restartable += own;
      initPeak = Math.max(initPeak, restartable);
    } else initPeak = Math.max(initPeak, restartable + own);
  }
  regular += restartable;
  const effective =
    podLevel === undefined ? Math.max(regular, initPeak) : quotaQuantity(podLevel);
  const overhead =
    field === "requests" || effective > 0 ? quotaQuantity(spec.overhead?.[resource] ?? "0") : 0;
  return effective + overhead;
}

export function findSandboxQuotaViolation(
  pods: k8s.V1PodSpec[],
  quotas: k8s.V1ResourceQuota[],
): string | null {
  const requirements: Record<string, number | null> = {
    pods: pods.length,
    "count/pods": pods.length,
  };
  for (const field of ["requests", "limits"] as const) {
    for (const resource of ["cpu", "memory"] as const) {
      const values = pods.map((pod) => podResourceRequirement(pod, field, resource));
      requirements[`${field}.${resource}`] = values.some((value) => value === null)
        ? null
        : values.reduce<number>((total, value) => total + (value ?? 0), 0);
      if (field === "requests")
        requirements[resource] = requirements[`${field}.${resource}`] ?? null;
    }
  }
  for (const quota of quotas) {
    // Only prove violations without guessing admission scope/defaulting behavior.
    if (
      (quota.spec?.scopes?.length ?? 0) > 0 ||
      (quota.spec?.scopeSelector?.matchExpressions?.length ?? 0) > 0
    )
      continue;
    const hard = quota.status?.hard ?? quota.spec?.hard ?? {};
    for (const [resource, requested] of Object.entries(requirements)) {
      const configured = hard[resource];
      if (configured === undefined || requested === null) continue;
      const maximum = quotaQuantity(configured);
      const tolerance = Math.max(1, requested, maximum) * Number.EPSILON * 128;
      if (requested > maximum + tolerance) {
        return `ResourceQuota ${quota.metadata?.name ?? "unnamed"}: ${resource} requires ${String(requested)}, exceeding hard ${configured}.`;
      }
    }
  }
  return null;
}
