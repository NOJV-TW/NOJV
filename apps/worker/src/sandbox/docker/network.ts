import { DockerCommandError, runDocker, runDockerCommand, sanitizeId } from "./process";
import {
  DOCKER_MANAGED_LABEL,
  buildDockerResourceLabels,
  dockerLabelArgs,
  hasExpiredDockerResourceLabels,
  parseDockerIds,
  parseDockerInspection,
} from "./resource";

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
  return hasExpiredDockerResourceLabels(inspection.Labels, nowMs);
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
  for (const id of parseDockerIds(stdout)) {
    const inspected = await runDockerCommand(["network", "inspect", id], {
      ignoreMissingResource: true,
    });
    const inspection = parseDockerInspection(inspected.stdout, "network");
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
