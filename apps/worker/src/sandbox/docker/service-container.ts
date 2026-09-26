import { buildAdvancedServiceArgs, SERVICE_READY_MARKER } from "@nojv/sandbox-docker";

import {
  attachDockerCleanupFailure,
  collectContainerLogs,
  forceRemoveContainer,
  runDockerCommand,
  sanitizeId,
} from "./process";
import { abortableSleep } from "../shared/execution-abort";

const READINESS_TIMEOUT_MS = 5_000;
const READINESS_INTERVAL_MS = 100;

export function serviceContainerName(runId: string): string {
  return `nojv-service-${sanitizeId(runId).slice(0, 36)}`;
}

export interface ServiceContainerHandle {
  containerName: string;
}

export async function waitForServiceReady(
  containerName: string,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await collectContainerLogs(containerName, signal)).includes(SERVICE_READY_MARKER)) {
      return;
    }
    await abortableSleep(READINESS_INTERVAL_MS, signal);
  }
  throw new Error(`service ${containerName} did not become ready within timeout`);
}

export async function startServiceContainer(params: {
  runId: string;
  internalName: string;
  imageRef: string;
  memoryMb: number;
  cpuLimit: string;
  pidsLimit: number;
  signal: AbortSignal;
  labels: Readonly<Record<string, string>>;
}): Promise<ServiceContainerHandle> {
  const containerName = serviceContainerName(params.runId);
  params.signal.throwIfAborted();
  try {
    await runDockerCommand(
      buildAdvancedServiceArgs({
        containerName,
        internalName: params.internalName,
        imageRef: params.imageRef,
        memoryMb: params.memoryMb,
        cpuLimit: params.cpuLimit,
        pidsLimit: params.pidsLimit,
        labels: params.labels,
      }),
      { signal: params.signal },
    );
    await waitForServiceReady(containerName, params.signal);
    return { containerName };
  } catch (err) {
    try {
      await forceRemoveContainer(containerName);
    } catch (cleanupFailure) {
      if (err instanceof Error) {
        throw attachDockerCleanupFailure(err, "Docker service container", cleanupFailure);
      }
      throw cleanupFailure;
    }
    throw err;
  }
}
