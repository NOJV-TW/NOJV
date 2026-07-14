import { DockerCommandError, runDocker, runDockerCommand, sanitizeId } from "./docker-process";
import {
  DOCKER_CREATED_AT_LABEL,
  DOCKER_EXPIRES_AT_LABEL,
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
  DOCKER_WORKER_LABEL,
  buildDockerResourceLabels,
  dockerLabelArgs,
} from "./docker-resource";

const INTERNAL_NETWORK_PREFIX = "nojv-net-internal-";

export interface SubmissionNetwork {
  internalName: string;
}

interface DockerNetworkInspection {
  Containers?: unknown;
  Labels?: unknown;
}

export function planSubmissionNetwork(runId: string): SubmissionNetwork {
  const id = sanitizeId(runId).slice(0, 40);
  return {
    internalName: `${INTERNAL_NETWORK_PREFIX}${id}`,
  };
}

export function buildCreateInternalNetworkArgs(
  name: string,
  labels: Readonly<Record<string, string>> = {},
): string[] {
  return ["network", "create", "--internal", ...dockerLabelArgs(labels), name];
}

export async function createSubmissionNetwork(
  runId: string,
  signal: AbortSignal,
): Promise<SubmissionNetwork> {
  const plan = planSubmissionNetwork(runId);
  signal.throwIfAborted();
  await runDocker(
    buildCreateInternalNetworkArgs(plan.internalName, buildDockerResourceLabels(runId)),
    signal,
  );
  return plan;
}

export async function removeSubmissionNetwork(network: SubmissionNetwork): Promise<void> {
  await runDockerCommand(["network", "rm", network.internalName], {
    ignoreMissingResource: true,
  });
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function shouldSweepNetworkInspection(
  inspection: DockerNetworkInspection,
  nowMs: number,
): boolean {
  if (
    !inspection.Labels ||
    typeof inspection.Labels !== "object" ||
    Array.isArray(inspection.Labels)
  ) {
    return false;
  }
  if (
    !inspection.Containers ||
    typeof inspection.Containers !== "object" ||
    Array.isArray(inspection.Containers)
  ) {
    return false;
  }
  if (Object.keys(inspection.Containers).length !== 0) return false;
  const labels = inspection.Labels as Record<string, unknown>;
  const createdAt = parseNonNegativeInteger(labels[DOCKER_CREATED_AT_LABEL]);
  const expiresAt = parseNonNegativeInteger(labels[DOCKER_EXPIRES_AT_LABEL]);
  return (
    labels[DOCKER_MANAGED_LABEL] === "true" &&
    typeof labels[DOCKER_WORKER_LABEL] === "string" &&
    labels[DOCKER_WORKER_LABEL].length > 0 &&
    typeof labels[DOCKER_RUN_LABEL] === "string" &&
    labels[DOCKER_RUN_LABEL].length > 0 &&
    createdAt !== null &&
    expiresAt !== null &&
    expiresAt > createdAt &&
    expiresAt <= nowMs
  );
}

function parseNetworkInspection(stdout: string): DockerNetworkInspection | null {
  if (stdout.length === 0) return null;
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Docker network inspect returned an unexpected payload.");
  }
  const inspection = parsed[0] as unknown;
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new Error("Docker network inspect returned a malformed resource.");
  }
  return inspection;
}

export async function sweepOrphanNetworks(nowMs = Date.now()): Promise<void> {
  const { stdout } = await runDockerCommand([
    "network",
    "ls",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--format",
    "{{.ID}}",
  ]);
  const ids = [
    ...new Set(
      stdout
        .split("\n")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  for (const id of ids) {
    const inspected = await runDockerCommand(["network", "inspect", id], {
      ignoreMissingResource: true,
    });
    const inspection = parseNetworkInspection(inspected.stdout);
    if (!inspection || !shouldSweepNetworkInspection(inspection, nowMs)) continue;
    try {
      await runDockerCommand(["network", "rm", id], { ignoreMissingResource: true });
    } catch (error) {
      if (error instanceof DockerCommandError && /active endpoints/i.test(error.stderr))
        continue;
      throw error;
    }
  }
}
