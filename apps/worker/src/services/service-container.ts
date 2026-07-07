import { SERVICE_READY_MARKER, buildAdvancedServiceArgs } from "@nojv/sandbox-docker";

import {
  collectContainerLogs,
  forceRemoveContainer,
  forceRemoveContainerSync,
  runDocker,
  sanitizeId,
} from "./docker-process";

export {
  ADVANCED_SERVICE_PORT,
  SERVICE_NETWORK_ALIAS,
  SERVICE_PORT_ENV,
  SERVICE_READY_MARKER,
} from "@nojv/sandbox-docker";

export const SERVICE_HOST_ENV = "NOJV_SERVICE_HOST";

const READINESS_TIMEOUT_MS = 5_000;
const READINESS_INTERVAL_MS = 100;

export function serviceContainerName(submissionId: string): string {
  return `nojv-service-${sanitizeId(submissionId).slice(0, 36)}`;
}

export function buildStartServiceArgs(params: {
  containerName: string;
  internalName: string;
  imageRef: string;
  memoryMb: number;
  cpuLimit: string;
  pidsLimit: number;
}): string[] {
  return buildAdvancedServiceArgs(params);
}

export interface ServiceContainerHandle {
  containerName: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServiceReady(containerName: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await collectServiceLogs(containerName)).includes(SERVICE_READY_MARKER)) {
      return;
    }
    await sleep(READINESS_INTERVAL_MS);
  }
}

export async function startServiceContainer(params: {
  submissionId: string;
  internalName: string;
  egressName: string;
  imageRef: string;
  memoryMb: number;
  cpuLimit: string;
  pidsLimit: number;
}): Promise<ServiceContainerHandle> {
  const containerName = serviceContainerName(params.submissionId);
  forceRemoveContainerSync(containerName);
  await runDocker(
    buildStartServiceArgs({
      containerName,
      internalName: params.internalName,
      imageRef: params.imageRef,
      memoryMb: params.memoryMb,
      cpuLimit: params.cpuLimit,
      pidsLimit: params.pidsLimit,
    }),
  );

  try {
    await runDocker(["network", "connect", params.egressName, containerName]);
    await waitForServiceReady(containerName);
    return { containerName };
  } catch (err) {
    forceRemoveContainer(containerName);
    throw err;
  }
}

export function collectServiceLogs(containerName: string): Promise<string> {
  return collectContainerLogs(containerName);
}

export function stopServiceContainer(containerName: string): void {
  forceRemoveContainer(containerName);
}
