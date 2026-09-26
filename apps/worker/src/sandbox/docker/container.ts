import { runDockerCommand } from "./process";
import {
  DOCKER_MANAGED_LABEL,
  hasExpiredDockerResourceLabels,
  parseDockerIds,
  parseDockerInspection,
} from "./resource";

function shouldSweepContainerInspection(
  inspection: Record<string, unknown>,
  nowMs: number,
): boolean {
  if (
    !inspection.Config ||
    typeof inspection.Config !== "object" ||
    Array.isArray(inspection.Config)
  ) {
    return false;
  }
  return hasExpiredDockerResourceLabels(
    (inspection.Config as Record<string, unknown>).Labels,
    nowMs,
  );
}

export async function sweepOrphanContainers(nowMs = Date.now()): Promise<void> {
  const { stdout } = await runDockerCommand([
    "container",
    "ls",
    "--all",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--format",
    "{{.ID}}",
  ]);
  for (const id of parseDockerIds(stdout)) {
    const inspected = await runDockerCommand(["container", "inspect", id], {
      ignoreMissingResource: true,
    });
    const inspection = parseDockerInspection(inspected.stdout, "container");
    if (!inspection || !shouldSweepContainerInspection(inspection, nowMs)) continue;
    await runDockerCommand(["container", "rm", "--force", id], {
      ignoreMissingResource: true,
    });
  }
}
