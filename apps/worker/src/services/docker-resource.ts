import { randomUUID } from "node:crypto";

export const DOCKER_MANAGED_LABEL = "io.nojv.sandbox.managed";
export const DOCKER_WORKER_LABEL = "io.nojv.sandbox.worker";
export const DOCKER_RUN_LABEL = "io.nojv.sandbox.run";
export const DOCKER_CREATED_AT_LABEL = "io.nojv.sandbox.created-at";
export const DOCKER_EXPIRES_AT_LABEL = "io.nojv.sandbox.expires-at";

const DEFAULT_RESOURCE_TTL_MS = 2 * 60 * 60 * 1_000;
const workerId = randomUUID();

export type DockerResourceLabels = Record<string, string>;

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function hasExpiredDockerResourceLabels(labels: unknown, nowMs: number): boolean {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return false;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("Docker resource sweep time must be a non-negative safe integer.");
  }
  const values = labels as Record<string, unknown>;
  const createdAt = parseNonNegativeInteger(values[DOCKER_CREATED_AT_LABEL]);
  const expiresAt = parseNonNegativeInteger(values[DOCKER_EXPIRES_AT_LABEL]);
  return (
    values[DOCKER_MANAGED_LABEL] === "true" &&
    typeof values[DOCKER_WORKER_LABEL] === "string" &&
    values[DOCKER_WORKER_LABEL].length > 0 &&
    typeof values[DOCKER_RUN_LABEL] === "string" &&
    values[DOCKER_RUN_LABEL].length > 0 &&
    createdAt !== null &&
    expiresAt !== null &&
    expiresAt > createdAt &&
    expiresAt <= nowMs
  );
}

export function buildDockerResourceLabels(
  runId: string,
  options: { workerId?: string; nowMs?: number; ttlMs?: number } = {},
): DockerResourceLabels {
  const owner = options.workerId ?? workerId;
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_RESOURCE_TTL_MS;
  if (runId.trim().length === 0 || owner.trim().length === 0) {
    throw new TypeError("Docker resource run and worker identifiers must be non-empty.");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("Docker resource creation time must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("Docker resource TTL must be a positive safe integer.");
  }
  return {
    [DOCKER_MANAGED_LABEL]: "true",
    [DOCKER_WORKER_LABEL]: owner,
    [DOCKER_RUN_LABEL]: runId,
    [DOCKER_CREATED_AT_LABEL]: String(nowMs),
    [DOCKER_EXPIRES_AT_LABEL]: String(nowMs + ttlMs),
  };
}

export function dockerLabelArgs(labels: Readonly<Record<string, string>>): string[] {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}
