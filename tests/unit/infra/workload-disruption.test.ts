import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function render(valuesFile: string): string[] {
  const gkeArgs = valuesFile.endsWith("values-gke.yaml")
    ? ["-f", "tests/fixtures/helm/gke-production-config.yaml"]
    : [];
  return execFileSync(
    "helm",
    [
      "template",
      "nojv",
      "infra/charts/nojv",
      "-f",
      valuesFile,
      "-f",
      "tests/fixtures/helm/immutable-image-digests.yaml",
      "-f",
      "tests/fixtures/helm/production-external-backups.yaml",
      ...gkeArgs,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).split(/^---$/m);
}

function find(docs: string[], kind: string, name: string): string {
  const doc = docs.find(
    (d) =>
      new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(d) &&
      new RegExp(`^  name:\\s*${name}\\s*$`, "m").test(d),
  );
  if (!doc) throw new Error(`rendered chart has no ${kind}/${name}`);
  return doc;
}

describe("workload disruption on GKE", () => {
  const docs = render("infra/charts/nojv/values-gke.yaml");

  it.each(["nojv-web", "nojv-worker", "nojv-worker-platform"])(
    "lets a drain evict one %s pod at a time",
    (name) => {
      const pdb = find(docs, "PodDisruptionBudget", name);
      expect(pdb).toContain("maxUnavailable: 1");
      expect(pdb).not.toContain("minAvailable");
      expect(pdb).toContain(`app.kubernetes.io/name: ${name}`);
    },
  );

  it.each(["nojv-web", "nojv-worker"])("softly spreads %s across zones and nodes", (name) => {
    const deployment = find(docs, "Deployment", name);
    for (const key of ["topology.kubernetes.io/zone", "kubernetes.io/hostname"]) {
      expect(deployment).toContain(`topologyKey: ${key}`);
    }
    expect(deployment).not.toContain("DoNotSchedule");
  });

  it.each([
    ["Deployment", "nojv-web"],
    ["Deployment", "nojv-worker"],
    ["Deployment", "nojv-worker-platform"],
    ["Job", "nojv-migrator"],
    ["Job", "nojv-seed"],
  ])("runs the Cloud SQL proxy as a native sidecar in %s/%s", (kind, name) => {
    const spec = find(docs, kind, name);
    const init = spec.indexOf("initContainers:");
    const containers = spec.indexOf("\n      containers:");
    const proxy = spec.indexOf("- name: cloudsql-proxy");
    expect(init).toBeGreaterThan(-1);
    expect(proxy).toBeGreaterThan(init);
    expect(proxy).toBeLessThan(containers);
    expect(spec.slice(containers)).not.toContain("restartPolicy: Always");
  });
});

describe("workload disruption on a single machine", () => {
  const docs = render("infra/charts/nojv/values-single-machine.yaml");

  it("renders no PodDisruptionBudget that could block a one-node drain", () => {
    expect(docs.some((d) => /^kind:\s*PodDisruptionBudget\s*$/m.test(d))).toBe(false);
  });

  it("never makes spread a scheduling requirement", () => {
    expect(docs.join("---")).not.toContain("DoNotSchedule");
  });

  it("caps Postgres memory at its request so node pressure evicts it last", () => {
    expect(find(docs, "Cluster", "nojv-pg")).toContain(
      [
        "  resources:",
        "    limits:",
        "      memory: 2Gi",
        "    requests:",
        "      cpu: 500m",
        "      memory: 2Gi",
      ].join("\n"),
    );
  });
});
