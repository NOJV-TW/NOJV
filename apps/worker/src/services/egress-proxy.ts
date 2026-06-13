import { spawn, spawnSync } from "node:child_process";

import { forceRemoveContainer, forceRemoveContainerSync, sanitizeId } from "./docker-process";

export const EGRESS_PROXY_IMAGE = "nojv-egress-proxy:local";
export const EGRESS_PROXY_PORT = 8888;

export function renderAllowlistEnv(allowlist: string[]): string {
  return allowlist
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

export function proxyContainerName(submissionId: string): string {
  return `nojv-egress-proxy-${sanitizeId(submissionId).slice(0, 36)}`;
}

export function proxyUrl(staticIp: string, port: number): string {
  return `http://${staticIp}:${String(port)}`;
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
  staticIp: string;
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
    "--ip",
    params.staticIp,
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

function runDocker(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env: process.env, stdio: "pipe" });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err: Error) => reject(err));
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`docker ${args.join(" ")} failed (${String(code)}): ${stderr.trim()}`));
    });
    child.stdin.end();
  });
}

export async function startEgressProxy(params: {
  submissionId: string;
  internalName: string;
  egressName: string;
  staticIp: string;
  allowlist: string[];
  port: number;
}): Promise<EgressProxyHandle> {
  const containerName = proxyContainerName(params.submissionId);
  forceRemoveContainerSync(containerName);
  await runDocker(
    buildStartProxyArgs({
      containerName,
      internalName: params.internalName,
      staticIp: params.staticIp,
      allowlist: params.allowlist,
      port: params.port,
    }),
  );
  await runDocker(["network", "connect", params.egressName, containerName]);
  return { containerName, proxyUrl: proxyUrl(params.staticIp, params.port) };
}

export function collectEgressProxyLogs(containerName: string): string {
  const result = spawnSync("docker", ["logs", containerName], {
    env: process.env,
    encoding: "utf8",
  });
  if (result.error) return "";
  return `${result.stdout}${result.stderr}`.trim();
}

export function stopEgressProxy(containerName: string): void {
  forceRemoveContainer(containerName);
}
