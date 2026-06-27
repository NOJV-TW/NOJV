import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const EGRESS_KEY = "nojv.egress";

function helmAvailable(): boolean {
  try {
    execSync("helm version", { cwd: repoRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

let renderedChart: string | undefined;
function renderChart(): string {
  if (renderedChart === undefined) {
    renderedChart = execSync(
      "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml",
      { cwd: repoRoot, encoding: "utf8" },
    );
  }
  return renderedChart;
}

function isolateDoc(render: string, kind: string, name: string): string {
  const doc = render
    .split(/^---$/m)
    .find(
      (d) => new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(d) && d.includes(`name: ${name}`),
    );
  if (doc === undefined) {
    throw new Error(`rendered chart has no ${kind}/${name}`);
  }
  return doc;
}

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

const helm = helmAvailable();
const describeHelm = helm ? describe : describe.skip;
if (!helm) {
  describe.skip("NetworkPolicy ↔ chart parity (skipped: helm not installed)", () => {
    it.skip("requires helm to render infra/charts/nojv", () => {});
  });
}

describeHelm(
  "NetworkPolicy deny-all relabel ↔ executor labels (sandbox isolation drift gate)",
  () => {
    it("sandbox deny-all selects pods WITHOUT nojv.egress (DoesNotExist), so labeled pods escape it", () => {
      const denyAll = isolateDoc(renderChart(), "NetworkPolicy", "deny-all-sandbox");
      const expressions = denyAllSelectorExpressions(denyAll);
      expect(
        expressions,
        "deny-all-sandbox must select on 'nojv.egress DoesNotExist' so per-submission policies can widen labeled pods",
      ).toContainEqual({ key: EGRESS_KEY, operator: "DoesNotExist" });
    });

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
  },
);

describeHelm("GKE worker NetworkPolicy egress boundary", () => {
  function workerEgress(): string {
    return isolateDoc(renderChart(), "NetworkPolicy", "worker-egress");
  }

  it("does not allow broad worker egress CIDRs", () => {
    const yaml = workerEgress();
    expect(yaml).not.toContain("cidr: 0.0.0.0/0");
    expect(yaml).not.toContain("cidr: 10.0.0.0/8");
    expect(yaml).not.toContain("cidr: 172.16.0.0/12");
    expect(yaml).not.toContain("cidr: 192.168.0.0/16");
  });

  it("does not allow worker egress over cleartext HTTP", () => {
    expect(workerEgress()).not.toMatch(/port:\s*80\b/);
  });

  it("limits Redis and Cloud SQL private endpoints to exact IPv4 hosts", () => {
    const yaml = workerEgress();
    const redisRule = /cidr:\s*(\d+\.\d+\.\d+\.\d+\/32)[\s\S]*?port:\s*6379\b/.exec(yaml);
    const cloudSqlRule = /cidr:\s*(\d+\.\d+\.\d+\.\d+\/32)[\s\S]*?port:\s*3307\b/.exec(yaml);

    expect(redisRule?.[1]).toBeDefined();
    expect(cloudSqlRule?.[1]).toBeDefined();
  });

  it("allows Google APIs only through private or restricted VIPs on TLS", () => {
    const yaml = workerEgress();
    expect(yaml).toContain("cidr: 199.36.153.4/30");
    expect(yaml).toContain("cidr: 199.36.153.8/30");
    expect(yaml).toMatch(
      /cidr:\s*199\.36\.153\.4\/30[\s\S]*cidr:\s*199\.36\.153\.8\/30[\s\S]*port:\s*443\b/,
    );
  });
});
