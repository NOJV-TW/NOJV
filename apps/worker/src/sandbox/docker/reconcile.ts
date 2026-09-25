import { hostname } from "node:os";

import { createLogger } from "../../logger.js";
import { runDockerCommand } from "./process.js";
import {
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
  parseDockerIds,
  parseDockerInspection,
} from "./resource.js";

const logger = createLogger("docker-reconcile");
type DockerResourceKind = "container" | "network";

async function listRunResources(kind: DockerResourceKind, runId: string): Promise<string[]> {
  const { stdout } = await runDockerCommand([
    kind,
    "ls",
    ...(kind === "container" ? ["--all"] : []),
    "--no-trunc",
    "--filter",
    `label=${DOCKER_MANAGED_LABEL}=true`,
    "--filter",
    `label=${DOCKER_RUN_LABEL}=${runId}`,
    "--format",
    "{{.ID}}",
  ]);
  const ids = parseDockerIds(stdout);
  if (ids.some((id) => !/^[0-9a-f]{64}$/.test(id))) {
    throw new Error("Docker resource listing returned an invalid immutable ID.");
  }
  return ids;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function inspectOwnedResource(
  kind: DockerResourceKind,
  id: string,
  runId: string,
): Promise<Record<string, unknown> | null> {
  const { stdout } = await runDockerCommand([kind, "inspect", id], {
    ignoreMissingResource: true,
  });
  const resource = parseDockerInspection(stdout, kind);
  if (!resource) return null;
  const labels = object(
    kind === "container" ? object(resource.Config)?.Labels : resource.Labels,
  );
  if (
    resource.Id !== id ||
    labels?.[DOCKER_MANAGED_LABEL] !== "true" ||
    labels[DOCKER_RUN_LABEL] !== runId
  ) {
    throw new Error("Docker resource ownership could not be verified.");
  }
  return resource;
}

export async function reconcileDockerRun(runId: string, owner?: string): Promise<boolean> {
  if (!owner || owner !== (process.env.HOSTNAME ?? hostname())) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId))
    return false;
  try {
    for (const id of await listRunResources("container", runId)) {
      let container = await inspectOwnedResource("container", id, runId);
      if (!container) continue;
      const state = object(container.State);
      if (typeof state?.Running !== "boolean" || typeof state.Restarting !== "boolean")
        return false;
      if (state.Running || state.Restarting) {
        await runDockerCommand(["container", "stop", "-t", "10", id], {
          timeoutMs: 15_000,
          ignoreMissingResource: true,
        });
        container = await inspectOwnedResource("container", id, runId);
        if (!container) continue;
      }
      const stopped = object(container.State);
      if (stopped?.Running !== false || stopped.Restarting !== false) return false;
      await runDockerCommand(["container", "rm", id], { ignoreMissingResource: true });
    }
    if ((await listRunResources("container", runId)).length > 0) return false;
    for (const id of await listRunResources("network", runId)) {
      const network = await inspectOwnedResource("network", id, runId);
      if (!network) continue;
      const attachments = object(network.Containers);
      if (!attachments || Object.keys(attachments).length !== 0) return false;
      await runDockerCommand(["network", "rm", id], { ignoreMissingResource: true });
    }
    const [containers, networks] = await Promise.all([
      listRunResources("container", runId),
      listRunResources("network", runId),
    ]);
    return containers.length === 0 && networks.length === 0;
  } catch (error) {
    logger.warn("Sandbox recovery could not confirm Docker resource cleanup", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
