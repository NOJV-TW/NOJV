import { SERVICE_READY_MARKER, buildAdvancedServiceArgs } from "@nojv/sandbox-docker";

import {
  attachDockerCleanupFailure,
  collectContainerLogs,
  forceRemoveContainer,
  runDocker,
  sanitizeId,
} from "./docker-process";
import { executionAbortReason } from "./execution-abort";

export {
  ADVANCED_SERVICE_PORT,
  SERVICE_NETWORK_ALIAS,
  SERVICE_PORT_ENV,
  SERVICE_READY_MARKER,
} from "@nojv/sandbox-docker";

export const SERVICE_HOST_ENV = "NOJV_SERVICE_HOST";

const READINESS_TIMEOUT_MS = 5_000;
const READINESS_INTERVAL_MS = 100;

export function serviceContainerName(runId: string): string {
  return `nojv-service-${sanitizeId(runId).slice(0, 36)}`;
}

export function buildStartServiceArgs(params: {
  containerName: string;
  internalName: string;
  imageRef: string;
  memoryMb: number;
  cpuLimit: string;
  pidsLimit: number;
  labels?: Readonly<Record<string, string>>;
}): string[] {
  return buildAdvancedServiceArgs(params);
}

export interface ServiceContainerHandle {
  containerName: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(executionAbortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForServiceReady(
  containerName: string,
  signal: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await collectServiceLogs(containerName, signal)).includes(SERVICE_READY_MARKER)) {
      return;
    }
    await sleep(READINESS_INTERVAL_MS, signal);
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
    await runDocker(
      buildStartServiceArgs({
        containerName,
        internalName: params.internalName,
        imageRef: params.imageRef,
        memoryMb: params.memoryMb,
        cpuLimit: params.cpuLimit,
        pidsLimit: params.pidsLimit,
        labels: params.labels,
      }),
      params.signal,
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

export function collectServiceLogs(
  containerName: string,
  signal: AbortSignal,
): Promise<string> {
  return collectContainerLogs(containerName, signal);
}

export function stopServiceContainer(containerName: string): Promise<void> {
  return forceRemoveContainer(containerName);
}
