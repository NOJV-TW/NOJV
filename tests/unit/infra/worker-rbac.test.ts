import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

function helmAvailable(): boolean {
  try {
    execSync("helm version", { cwd: repoRoot, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const describeHelm = helmAvailable() ? describe : describe.skip;

describeHelm("sandbox Job watch RBAC", () => {
  it("grants only namespaced Job list/watch in addition to existing lifecycle verbs", () => {
    const rendered = execSync(
      "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml -f tests/fixtures/helm/immutable-image-digests.yaml -f tests/fixtures/helm/gke-production-config.yaml -f tests/fixtures/helm/production-external-backups.yaml",
      { cwd: repoRoot, encoding: "utf8" },
    );
    const role = rendered
      .split(/^---$/m)
      .find(
        (doc) =>
          /^kind:\s*Role\s*$/m.test(doc) && doc.includes("name: nojv-sandbox-job-manager"),
      );

    expect(role).toBeDefined();
    expect(role).toMatch(
      /resources:\s*\["jobs"\][\s\S]*verbs:\s*\["create", "get", "list", "watch", "delete"\]/,
    );
    expect(role).not.toMatch(/resources:\s*\["jobs"\][\s\S]*verbs:[^\n]*(update|patch)/);
    expect(role).not.toContain('resources: ["secrets"]');
  });
});

describeHelm("judge capacity quota ownership", () => {
  const args =
    "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-single-machine.yaml -f tests/fixtures/helm/immutable-image-digests.yaml -f tests/fixtures/helm/production-external-backups.yaml";
  it("retains static quota before handoff, and gives the enabled controller sole ownership", () => {
    const legacy = execSync(args, { cwd: repoRoot, encoding: "utf8" });
    expect(legacy).toContain("helm.sh/resource-policy: keep");
    expect(legacy).toContain("kind: ResourceQuota");
    expect(legacy).not.toContain("name: nojv-worker-control");
    const enabled = execSync(`${args} --set worker.sandbox.capacityAdmission.enabled=true`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(enabled).not.toContain("kind: ResourceQuota");
    expect(enabled).toContain("name: nojv-worker-control");
    expect(enabled).toContain('resourceNames: ["sandbox-quota"]');
    for (const deployment of enabled
      .split(/^---$/m)
      .filter(
        (doc) =>
          /^kind:\s*Deployment\s*$/m.test(doc) && /name: nojv-worker(?:-control)?\n/.test(doc),
      )) {
      expect(deployment).toMatch(/strategy:\s*\n\s*type: Recreate/);
    }
  });
});
