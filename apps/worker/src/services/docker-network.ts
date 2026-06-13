import { spawn, spawnSync } from "node:child_process";

import { sanitizeId } from "./docker-process";

const INTERNAL_NETWORK_PREFIX = "nojv-net-internal-";
const EGRESS_NETWORK_PREFIX = "nojv-net-egress-";

export interface SubmissionNetworks {
  internalName: string;
  egressName: string;
  internalSubnet: string;
  proxyInternalIp: string;
}

function octetFromId(submissionId: string): number {
  let hash = 0;
  for (const ch of submissionId) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 251;
  }
  return hash + 2;
}

export function planSubmissionNetworks(submissionId: string): SubmissionNetworks {
  const id = sanitizeId(submissionId).slice(0, 40);
  const octet = octetFromId(submissionId);
  return {
    internalName: `${INTERNAL_NETWORK_PREFIX}${id}`,
    egressName: `${EGRESS_NETWORK_PREFIX}${id}`,
    internalSubnet: `10.88.${String(octet)}.0/24`,
    proxyInternalIp: `10.88.${String(octet)}.2`,
  };
}

export function buildCreateInternalNetworkArgs(name: string, subnet: string): string[] {
  return ["network", "create", "--internal", "--subnet", subnet, name];
}

export function buildCreateEgressNetworkArgs(name: string): string[] {
  return ["network", "create", name];
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

export async function createSubmissionNetworks(
  submissionId: string,
): Promise<SubmissionNetworks> {
  const plan = planSubmissionNetworks(submissionId);
  removeSubmissionNetworks(plan);
  await runDocker(buildCreateInternalNetworkArgs(plan.internalName, plan.internalSubnet));
  await runDocker(buildCreateEgressNetworkArgs(plan.egressName));
  return plan;
}

export function removeSubmissionNetworks(
  networks: Pick<SubmissionNetworks, "internalName" | "egressName">,
): void {
  spawnSync("docker", ["network", "rm", "-f", networks.internalName], {
    env: process.env,
    stdio: "ignore",
  });
  spawnSync("docker", ["network", "rm", "-f", networks.egressName], {
    env: process.env,
    stdio: "ignore",
  });
}

export function sweepOrphanNetworks(): void {
  const child = spawnSync(
    "docker",
    [
      "network",
      "ls",
      "--filter",
      `name=${INTERNAL_NETWORK_PREFIX}`,
      "--filter",
      `name=${EGRESS_NETWORK_PREFIX}`,
      "--format",
      "{{.Name}}",
    ],
    { env: process.env, encoding: "utf8" },
  );
  if (child.status !== 0 || !child.stdout) return;
  const names = child.stdout
    .split("\n")
    .map((n) => n.trim())
    .filter(
      (n) => n.startsWith(INTERNAL_NETWORK_PREFIX) || n.startsWith(EGRESS_NETWORK_PREFIX),
    );
  for (const name of names) {
    spawnSync("docker", ["network", "rm", "-f", name], { env: process.env, stdio: "ignore" });
  }
}
