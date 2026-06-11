import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function networkPolicyMatchLabels(): Record<string, string> {
  const yaml = readFileSync(join(repoRoot, "infra/k8s/sandbox/network-policy.yaml"), "utf8");
  const lines = yaml.split("\n");
  const labels: Record<string, string> = {};
  let inMatch = false;
  let matchIndent = -1;
  for (const line of lines) {
    const m = /^(\s*)matchLabels:\s*$/.exec(line);
    if (m) {
      inMatch = true;
      matchIndent = m[1].length;
      continue;
    }
    if (!inMatch) continue;
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== "" && indent <= matchIndent) break;
    const pair = /^\s+([\w.\-/]+):\s*(\S+)/.exec(line);
    if (pair) labels[pair[1]] = pair[2];
  }
  return labels;
}

function executorLabelSets(): Record<string, string>[] {
  const src = readFileSync(join(repoRoot, "apps/worker/src/services/k8s-executor.ts"), "utf8");
  const sets: Record<string, string>[] = [];
  for (const block of src.matchAll(/labels:\s*\{([^}]*)\}/g)) {
    const set: Record<string, string> = {};
    for (const pair of block[1].matchAll(/(?:"([^"]+)"|([A-Za-z_][\w-]*))\s*:\s*"([^"]+)"/g)) {
      set[pair[1] ?? pair[2]] = pair[3];
    }
    if (Object.keys(set).length > 0) sets.push(set);
  }
  return sets;
}

describe("NetworkPolicy ↔ k8s-executor pod label parity (sandbox isolation drift gate)", () => {
  const matchLabels = networkPolicyMatchLabels();
  const labelSets = executorLabelSets();

  it("the NetworkPolicy selects on at least one label and the executor labels at least one pod", () => {
    expect(Object.keys(matchLabels).length).toBeGreaterThan(0);
    expect(labelSets.length).toBeGreaterThan(0);
  });

  it("every pod the executor labels carries the deny-all NetworkPolicy's selector labels", () => {
    for (const set of labelSets) {
      for (const [key, value] of Object.entries(matchLabels)) {
        expect(
          set[key],
          `executor labels ${JSON.stringify(set)} miss selector ${key}=${value} → deny-all NetworkPolicy would not apply (sandbox could reach the network)`,
        ).toBe(value);
      }
    }
  });
});
