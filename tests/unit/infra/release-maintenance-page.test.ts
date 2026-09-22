import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

function render(upgrade: boolean): string[] {
  const args = [
    "template",
    "nojv",
    "infra/charts/nojv",
    ...(upgrade ? ["--is-upgrade"] : []),
    "-f",
    "infra/charts/nojv/values-single-machine.yaml",
    "-f",
    "tests/fixtures/helm/immutable-image-digests.yaml",
    "-f",
    "tests/fixtures/helm/production-external-backups.yaml",
  ];
  return execFileSync("helm", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).split(/^---$/m);
}

function findByName(docs: string[], kind: string, name: string): string {
  const metaName = new RegExp(`^  name: ${name}$`, "m");
  return docs.find((doc) => doc.includes(`kind: ${kind}\n`) && metaName.test(doc)) ?? "";
}

function imageOf(doc: string): string {
  return /^\s+image: (\S+)$/m.exec(doc)?.[1] ?? "";
}

describeHelm("release window serves a maintenance page instead of no endpoints", () => {
  const upgrade = render(true);
  const install = render(false);
  const maintenance = findByName(upgrade, "Deployment", "nojv-web-maintenance");
  const web = findByName(upgrade, "Deployment", "nojv-web");
  const service = findByName(upgrade, "Service", "nojv-web");

  it("drains web but keeps a pod behind the same service selector", () => {
    expect(web).toMatch(/replicas: 0/);
    expect(service).toMatch(/selector:\n\s+app\.kubernetes\.io\/name: nojv-web\n/);
    expect(maintenance).not.toBe("");
    expect(maintenance).toMatch(/app\.kubernetes\.io\/name: nojv-web\n/);
    expect(maintenance).toMatch(/nojv\.tw\/role: maintenance\n/);
  });

  it("reuses the already-pulled web image and names the port the service targets", () => {
    expect(imageOf(maintenance)).toBe(imageOf(web));
    expect(imageOf(maintenance)).toMatch(/@sha256:/);
    expect(maintenance).toMatch(/imagePullPolicy: IfNotPresent/);
    expect(maintenance).toMatch(/name: http\n/);
    expect(service).toMatch(/targetPort: http/);
  });

  it("answers 503 with a retry hint and passes its own readiness probe", () => {
    expect(maintenance).toMatch(/res\.writeHead\(503/);
    expect(maintenance).toMatch(/"retry-after"/);
    expect(maintenance).toMatch(/path: \/healthz/);
  });

  it("keeps the drain check from waiting on the maintenance pod", () => {
    const migrator = findByName(upgrade, "Job", "nojv-migrator");
    const restore = findByName(upgrade, "Job", "nojv-workloads-ready");
    for (const job of [migrator, restore]) {
      expect(job).toContain('value: "app.kubernetes.io/name=nojv-web,!nojv.tw/role"');
    }
  });

  it("is absent outside a release window", () => {
    expect(findByName(install, "Deployment", "nojv-web-maintenance")).toBe("");
  });

  it("retires the page only after the real deployment is ready", () => {
    const script = readFileSync(
      join(repoRoot, "infra/charts/nojv/files/release-workloads.sh"),
      "utf8",
    );
    const scaleDown = script.indexOf('scale deployment "$MAINTENANCE_DEPLOYMENT" --replicas=0');
    const readyGate = script.indexOf(
      "Timed out waiting for the new web and worker deployments",
    );
    expect(scaleDown).toBeGreaterThan(readyGate);
    expect(script).toMatch(
      /scale deployment "\$MAINTENANCE_DEPLOYMENT" \\\n\s+--replicas="\$MAINTENANCE_PAGE_REPLICAS"/,
    );
  });
});
