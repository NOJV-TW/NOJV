import { spawnSync } from "node:child_process";

import { runDocker, sanitizeId } from "./docker-process";

const INTERNAL_NETWORK_PREFIX = "nojv-net-internal-";
const EGRESS_NETWORK_PREFIX = "nojv-net-egress-";

export interface SubmissionNetworks {
  internalName: string;
  egressName: string;
}

export function planSubmissionNetworks(submissionId: string): SubmissionNetworks {
  const id = sanitizeId(submissionId).slice(0, 40);
  return {
    internalName: `${INTERNAL_NETWORK_PREFIX}${id}`,
    egressName: `${EGRESS_NETWORK_PREFIX}${id}`,
  };
}

export function buildCreateInternalNetworkArgs(name: string): string[] {
  return ["network", "create", "--internal", name];
}

export function buildCreateEgressNetworkArgs(name: string): string[] {
  return ["network", "create", name];
}

export async function createSubmissionNetworks(
  submissionId: string,
): Promise<SubmissionNetworks> {
  const plan = planSubmissionNetworks(submissionId);
  removeSubmissionNetworks(plan);
  await runDocker(buildCreateInternalNetworkArgs(plan.internalName));
  try {
    await runDocker(buildCreateEgressNetworkArgs(plan.egressName));
  } catch (err) {
    removeSubmissionNetworks(plan);
    throw err;
  }
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
