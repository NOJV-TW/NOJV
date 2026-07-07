export const SANDBOX_RUN_USER = "10001:10001";

export const SERVICE_NETWORK_ALIAS = "service";
export const SERVICE_PORT_ENV = "PORT";
export const SERVICE_READY_MARKER = "NOJV_SERVICE_READY";
export const ADVANCED_SERVICE_PORT = 8888;

export const EGRESS_PROXY_IMAGE = "nojv-egress-proxy:local";
export const EGRESS_PROXY_PORT = 8888;
export const PROXY_READY_MARKER = "NOJV_PROXY_READY";

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

export function renderAllowlistEnv(allowlist: string[]): string {
  return allowlist
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

export function buildProxyEnvArgs(allowlist: string[], port: number): string[] {
  return [
    "--env",
    `NOJV_ALLOWLIST=${renderAllowlistEnv(allowlist)}`,
    "--env",
    `NOJV_PROXY_PORT=${String(port)}`,
  ];
}

export function buildAdvancedProxyArgs(params: {
  containerName: string;
  internalName: string;
  allowlist: string[];
  port: number;
}): string[] {
  return [
    "run",
    "-d",
    "--rm",
    "--name",
    params.containerName,
    "--network",
    params.internalName,
    "--user",
    SANDBOX_RUN_USER,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,nodev,size=16m",
    "--memory",
    "128m",
    "--memory-swap",
    "128m",
    "--cpus",
    "0.25",
    "--pids-limit",
    "128",
    ...buildProxyEnvArgs(params.allowlist, params.port),
    EGRESS_PROXY_IMAGE,
  ];
}
