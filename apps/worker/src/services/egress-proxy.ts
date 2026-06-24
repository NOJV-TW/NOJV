import {
  collectContainerLogs,
  forceRemoveContainer,
  forceRemoveContainerSync,
  inspectContainerNetworkIp,
  runDocker,
  sanitizeId,
} from "./docker-process";

export const EGRESS_PROXY_IMAGE = "nojv-egress-proxy:local";
export const EGRESS_PROXY_PORT = 8888;
export const PROXY_READY_MARKER = "NOJV_PROXY_READY";

const READINESS_TIMEOUT_MS = 3_000;
const READINESS_INTERVAL_MS = 100;

export function renderAllowlistEnv(allowlist: string[]): string {
  return allowlist
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

export function proxyContainerName(submissionId: string): string {
  return `nojv-egress-proxy-${sanitizeId(submissionId).slice(0, 36)}`;
}

export function proxyUrl(ip: string, port: number): string {
  return `http://${ip}:${String(port)}`;
}

export function buildProxyEnvArgs(allowlist: string[], port: number): string[] {
  return [
    "--env",
    `NOJV_ALLOWLIST=${renderAllowlistEnv(allowlist)}`,
    "--env",
    `NOJV_PROXY_PORT=${String(port)}`,
  ];
}

export function buildStartProxyArgs(params: {
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
    "10001:10001",
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

export interface EgressProxyHandle {
  containerName: string;
  proxyUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProxyReady(containerName: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await collectEgressProxyLogs(containerName)).includes(PROXY_READY_MARKER)) {
      return;
    }
    await sleep(READINESS_INTERVAL_MS);
  }
  throw new Error(`egress-proxy ${containerName} did not become ready within timeout`);
}

export async function startEgressProxy(params: {
  submissionId: string;
  internalName: string;
  egressName: string;
  allowlist: string[];
  port: number;
}): Promise<EgressProxyHandle> {
  const containerName = proxyContainerName(params.submissionId);
  forceRemoveContainerSync(containerName);
  await runDocker(
    buildStartProxyArgs({
      containerName,
      internalName: params.internalName,
      allowlist: params.allowlist,
      port: params.port,
    }),
  );

  try {
    await runDocker(["network", "connect", params.egressName, containerName]);

    const ip = inspectContainerNetworkIp(containerName, params.internalName);
    if (!ip) {
      throw new Error(`could not resolve egress-proxy IP on ${params.internalName}`);
    }

    await waitForProxyReady(containerName);

    return { containerName, proxyUrl: proxyUrl(ip, params.port) };
  } catch (err) {
    forceRemoveContainer(containerName);
    throw err;
  }
}

export function collectEgressProxyLogs(containerName: string): Promise<string> {
  return collectContainerLogs(containerName);
}

export function stopEgressProxy(containerName: string): void {
  forceRemoveContainer(containerName);
}
