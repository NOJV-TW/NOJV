import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const EGRESS_KEY = "nojv.egress";

function denyAllSelectorExpressions(yaml: string): { key: string; operator: string }[] {
  const lines = yaml.split("\n");
  const expressions: { key: string; operator: string }[] = [];
  let inMatch = false;
  let matchIndent = -1;
  let pendingKey: string | null = null;
  for (const line of lines) {
    const m = /^(\s*)matchExpressions:\s*$/.exec(line);
    if (m) {
      inMatch = true;
      matchIndent = m[1].length;
      continue;
    }
    if (!inMatch) continue;
    const indent = line.length - line.trimStart().length;
    if (line.trim() !== "" && indent <= matchIndent) break;
    const keyMatch = /^\s*-?\s*key:\s*([\w.\-/]+)\s*$/.exec(line);
    if (keyMatch) pendingKey = keyMatch[1];
    const opMatch = /^\s*operator:\s*(\S+)\s*$/.exec(line);
    if (opMatch && pendingKey) {
      expressions.push({ key: pendingKey, operator: opMatch[1] });
      pendingKey = null;
    }
  }
  return expressions;
}

function executorLabelSets(): Record<string, string>[] {
  const src = [
    "apps/worker/src/services/k8s-executor.ts",
    "apps/worker/src/services/k8s-job-manifests.ts",
  ]
    .map((p) => readFileSync(join(repoRoot, p), "utf8"))
    .join("\n");
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

describe("NetworkPolicy deny-all relabel ↔ executor labels (sandbox isolation drift gate)", () => {
  const denyAllManifests = [
    "infra/k8s/sandbox/network-policy.yaml",
    "infra/gcp/gke/network-policy.yaml",
  ];

  it.each(denyAllManifests)(
    "%s deny-all selects pods WITHOUT nojv.egress (DoesNotExist), so labeled pods escape it",
    (path) => {
      const yaml = readFileSync(join(repoRoot, path), "utf8");
      const expressions = denyAllSelectorExpressions(yaml);
      expect(
        expressions,
        `${path} deny-all must select on 'nojv.egress DoesNotExist' so per-submission policies can widen labeled pods`,
      ).toContainEqual({ key: EGRESS_KEY, operator: "DoesNotExist" });
    },
  );

  it("SECURITY: every plain sandbox pod the executor labels stays under deny-all (no nojv.egress)", () => {
    const labelSets = executorLabelSets();
    expect(labelSets.length).toBeGreaterThan(0);
    for (const set of labelSets) {
      expect(
        set[EGRESS_KEY],
        `executor labels ${JSON.stringify(set)} carry ${EGRESS_KEY} → would ESCAPE deny-all without a per-submission policy (standard/checker/interactive/none must stay denied)`,
      ).toBeUndefined();
      expect(set.app).toBe("nojv-sandbox");
    }
  });

  it("advanced run/grade builders emit the nojv.egress escape label so per-submission policies apply", () => {
    const src = readFileSync(
      join(repoRoot, "apps/worker/src/services/k8s-advanced.ts"),
      "utf8",
    );
    expect(src).toContain('"nojv.egress": params.egressLabel');
  });
});

describe("GKE worker NetworkPolicy egress boundary", () => {
  const yaml = readFileSync(join(repoRoot, "infra/gcp/gke/network-policy.yaml"), "utf8");

  it("does not allow broad worker egress CIDRs", () => {
    expect(yaml).not.toContain("cidr: 0.0.0.0/0");
    expect(yaml).not.toContain("cidr: 10.0.0.0/8");
    expect(yaml).not.toContain("cidr: 172.16.0.0/12");
    expect(yaml).not.toContain("cidr: 192.168.0.0/16");
  });

  it("does not allow worker egress over cleartext HTTP", () => {
    expect(yaml).not.toMatch(/port:\s*80\b/);
  });

  it("limits Redis and Cloud SQL private endpoints to exact IPv4 hosts", () => {
    const redisRule = /cidr:\s*(\d+\.\d+\.\d+\.\d+\/32)[\s\S]*?port:\s*6379\b/.exec(yaml);
    const cloudSqlRule = /cidr:\s*(\d+\.\d+\.\d+\.\d+\/32)[\s\S]*?port:\s*3307\b/.exec(yaml);

    expect(redisRule?.[1]).toBeDefined();
    expect(cloudSqlRule?.[1]).toBeDefined();
  });

  it("allows Google APIs only through private or restricted VIPs on TLS", () => {
    expect(yaml).toContain("cidr: 199.36.153.4/30");
    expect(yaml).toContain("cidr: 199.36.153.8/30");
    expect(yaml).toMatch(
      /cidr:\s*199\.36\.153\.4\/30[\s\S]*cidr:\s*199\.36\.153\.8\/30[\s\S]*port:\s*443\b/,
    );
  });
});
