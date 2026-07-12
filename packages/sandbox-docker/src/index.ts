export const SANDBOX_RUN_USER = "10001:10001";

export const SERVICE_NETWORK_ALIAS = "service";
export const SERVICE_PORT_ENV = "PORT";
export const SERVICE_READY_MARKER = "NOJV_SERVICE_READY";
export const ADVANCED_SERVICE_PORT = 8888;

export function buildAdvancedServiceArgs(params: {
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
    "--user",
    SANDBOX_RUN_USER,
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
