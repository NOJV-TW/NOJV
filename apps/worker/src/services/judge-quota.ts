import type { JudgeCapacitySnapshot, JudgePermit } from "./judge-capacity";

export function judgeQuota(
  snapshot: JudgeCapacitySnapshot,
  permits: JudgePermit[],
): { cpuMillis: number; memoryBytes: number; pods: number } {
  const names = new Set([
    ...snapshot.nodes.map((node) => node.name),
    ...permits.map((permit) => permit.nodeName),
  ]);
  let cpuMillis = 0;
  let memoryBytes = 0;
  for (const name of names) {
    const node = snapshot.nodes.find((candidate) => candidate.name === name);
    const held = permits.filter(
      (permit) => permit.nodeName === name && !permit.cleanupConfirmed,
    );
    cpuMillis += Math.max(
      node?.eligible ? node.budget.cpuMillis : 0,
      held.reduce((sum, permit) => sum + permit.resources.cpuMillis, 0),
    );
    memoryBytes += Math.max(
      node?.eligible ? node.budget.memoryBytes : 0,
      held.reduce((sum, permit) => sum + permit.resources.memoryBytes, 0),
    );
  }
  return {
    cpuMillis,
    memoryBytes,
    pods: Math.max(
      permits.filter((permit) => !permit.cleanupConfirmed).length,
      Math.floor(cpuMillis / 1000),
    ),
  };
}
