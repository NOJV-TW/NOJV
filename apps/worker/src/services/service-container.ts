import {
  collectContainerLogs,
  forceRemoveContainer,
  forceRemoveContainerSync,
  runDocker,
  sanitizeId,
} from "./docker-process";

export const SERVICE_NETWORK_ALIAS = "service";
export const SERVICE_HOST_ENV = "NOJV_SERVICE_HOST";
export const SERVICE_PORT_ENV = "PORT";
export const SERVICE_READY_MARKER = "NOJV_SERVICE_READY";

export const ADVANCED_SERVICE_PORT = 8888;

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
  return [
    "run",
    "-d",
    "--rm",
    "--name",
    params.containerName,
    "--network",
    params.internalName,
    "--network-alias",
    SERVICE_NETWORK_ALIAS,
    "-e",
    `${SERVICE_PORT_ENV}=${String(ADVANCED_SERVICE_PORT)}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=64m",
    "--memory",
    `${String(params.memoryMb)}m`,
    "--memory-swap",
    `${String(params.memoryMb)}m`,
    "--cpus",
    params.cpuLimit,
    "--pids-limit",
    String(params.pidsLimit),
    params.imageRef,
  ];
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
