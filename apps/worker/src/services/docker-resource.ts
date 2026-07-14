import { randomUUID } from "node:crypto";

export const DOCKER_MANAGED_LABEL = "io.nojv.sandbox.managed";
export const DOCKER_WORKER_LABEL = "io.nojv.sandbox.worker";
export const DOCKER_RUN_LABEL = "io.nojv.sandbox.run";
export const DOCKER_CREATED_AT_LABEL = "io.nojv.sandbox.created-at";
export const DOCKER_EXPIRES_AT_LABEL = "io.nojv.sandbox.expires-at";

const DEFAULT_RESOURCE_TTL_MS = 2 * 60 * 60 * 1_000;
const workerId = randomUUID();

export type DockerResourceLabels = Record<string, string>;

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
