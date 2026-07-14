import { spawnSync } from "node:child_process";

import { runDocker, sanitizeId } from "./docker-process";

const INTERNAL_NETWORK_PREFIX = "nojv-net-internal-";

export interface SubmissionNetwork {
  internalName: string;
}

export function planSubmissionNetwork(submissionId: string): SubmissionNetwork {
  const id = sanitizeId(submissionId).slice(0, 40);
  return {
    internalName: `${INTERNAL_NETWORK_PREFIX}${id}`,
  };
}

export function buildCreateInternalNetworkArgs(name: string): string[] {
  return ["network", "create", "--internal", name];
}

export async function createSubmissionNetwork(
  submissionId: string,
  signal: AbortSignal,
): Promise<SubmissionNetwork> {
  const plan = planSubmissionNetwork(submissionId);
  removeSubmissionNetwork(plan);
  signal.throwIfAborted();
  try {
    await runDocker(buildCreateInternalNetworkArgs(plan.internalName), signal);
    return plan;
  } catch (error) {
    removeSubmissionNetwork(plan);
    throw error;
  }
}

export function removeSubmissionNetwork(network: SubmissionNetwork): void {
  spawnSync("docker", ["network", "rm", "-f", network.internalName], {
    env: process.env,
    stdio: "ignore",
  });
}

export function sweepOrphanNetworks(): void {
  const child = spawnSync(
    "docker",
    ["network", "ls", "--filter", `name=${INTERNAL_NETWORK_PREFIX}`, "--format", "{{.Name}}"],
    { env: process.env, encoding: "utf8" },
  );
  if (child.status !== 0 || !child.stdout) return;
  const names = child.stdout
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n.startsWith(INTERNAL_NETWORK_PREFIX));
  for (const name of names) {
    spawnSync("docker", ["network", "rm", "-f", name], { env: process.env, stdio: "ignore" });
  }
}
