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

describeHelm("release image prepull runs before the maintenance drain", () => {
  const rendered = execSync(
    "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml -f tests/fixtures/helm/immutable-image-digests.yaml -f tests/fixtures/helm/gke-production-config.yaml -f tests/fixtures/helm/production-external-backups.yaml",
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const docs = rendered.split(/^---$/m);
  const hookWeight = (doc: string) => Number(/helm\.sh\/hook-weight: "(-?\d+)"/.exec(doc)?.[1]);
  const prepull = docs.find((doc) => /name: nojv-release-prepull\n/.test(doc)) ?? "";
  const migrator =
    docs.find((doc) => /kind: Job\n[\s\S]*name: nojv-migrator\n/.test(doc)) ?? "";

  it("pulls both runtime images with a no-op command", () => {
    expect(prepull).toMatch(/helm\.sh\/hook: pre-install,pre-upgrade/);
    expect(prepull).toMatch(/\/web:[^@\s]+@sha256:/);
    expect(prepull).toMatch(/\/worker:[^@\s]+@sha256:/);
    expect((prepull.match(/imagePullPolicy: Always/g) ?? []).length).toBe(2);
    expect(prepull).toMatch(/command: \["node", "-e", "0"\]/);
  });

  it("is ordered ahead of the migrator, which drains the workloads", () => {
    expect(migrator).not.toBe("");
    expect(hookWeight(prepull)).toBeLessThan(hookWeight(migrator));
  });
});
