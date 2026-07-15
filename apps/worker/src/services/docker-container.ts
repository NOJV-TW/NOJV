import { runDockerCommand } from "./docker-process";
import { DOCKER_MANAGED_LABEL, hasExpiredDockerResourceLabels } from "./docker-resource";

interface DockerContainerInspection {
  Config?: unknown;
}

function parseContainerInspection(stdout: string): DockerContainerInspection | null {
  if (stdout.length === 0) return null;
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Docker container inspect returned an unexpected payload.");
  }
  const inspection = parsed[0] as unknown;
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new Error("Docker container inspect returned a malformed resource.");
  }
  return inspection;
}

export function shouldSweepContainerInspection(
  inspection: DockerContainerInspection,
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
  const ids = [
    ...new Set(
      stdout
        .split("\n")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  for (const id of ids) {
    const inspected = await runDockerCommand(["container", "inspect", id], {
      ignoreMissingResource: true,
    });
    const inspection = parseContainerInspection(inspected.stdout);
    if (!inspection || !shouldSweepContainerInspection(inspection, nowMs)) continue;
    await runDockerCommand(["container", "rm", "--force", id], {
      ignoreMissingResource: true,
    });
  }
}
