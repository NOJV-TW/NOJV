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

describeHelm("judge worker rendering", () => {
  const args =
    "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-single-machine.yaml -f tests/fixtures/helm/immutable-image-digests.yaml -f tests/fixtures/helm/production-external-backups.yaml";
  it("renders the retained static sandbox quota and a single judge worker without capacity flags", () => {
    const rendered = execSync(args, { cwd: repoRoot, encoding: "utf8" });
    expect(rendered).toContain("helm.sh/resource-policy: keep");
    expect(rendered).toContain("kind: ResourceQuota");
    expect(rendered).not.toContain("name: nojv-worker-control");
    expect(rendered).not.toContain("JUDGE_CAPACITY_ROUTING");
    expect(rendered).not.toContain("K8S_CAPACITY_ADMISSION");
    expect(rendered).not.toContain('resourceNames: ["sandbox-quota"]');
    const judge = rendered
      .split(/^---$/m)
      .find((doc) => /^kind: Deployment$/m.test(doc) && doc.includes("name: nojv-worker\n"));
    expect(judge).toMatch(/strategy:\s*\n\s*type: Recreate/);
  });
});
