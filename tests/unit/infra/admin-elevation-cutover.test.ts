import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const chartRoot = join(repoRoot, "infra/charts/nojv");
const tempDirectories: string[] = [];

function renderChart(valuesFile: string): string {
  const gkeFixture = valuesFile.endsWith("values-gke.yaml")
    ? " -f tests/fixtures/helm/gke-production-config.yaml"
    : "";
  return execSync(
    `helm template nojv infra/charts/nojv -f ${valuesFile} -f tests/fixtures/helm/immutable-image-digests.yaml${gkeFixture} -f tests/fixtures/helm/production-external-backups.yaml`,
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

function renderedResource(render: string, kind: string, name: string): string {
  const resource = render
    .split(/^---$/m)
    .find(
      (document) =>
        new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(document) &&
        new RegExp(`^  name:\\s*${name}\\s*$`, "m").test(document),
    );
  if (!resource) throw new Error(`rendered chart has no ${kind}/${name}`);
  return resource;
}

function fakeKubectl(script: string): { bin: string; log: string } {
  const directory = mkdtempSync(join(tmpdir(), "nojv-kubectl-"));
  tempDirectories.push(directory);
  const bin = join(directory, "kubectl");
  const log = join(directory, "calls.log");
  writeFileSync(bin, script, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return { bin: directory, log };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("admin-elevation mixed-version deployment cutover", () => {
  it("makes the migrator own maintenance and waits for the new web revision", () => {
    const render = renderChart("infra/charts/nojv/values-gke.yaml");
    const migrator = renderedResource(render, "Job", "nojv-migrator");
    const ready = renderedResource(render, "Job", "nojv-workloads-ready");

    expect(render).not.toContain("name: nojv-web-drain");
    expect(migrator).toContain("helm.sh/hook: pre-install,pre-upgrade");
    expect(migrator).toContain('helm.sh/hook-weight: "-5"');
    expect(migrator).toContain("serviceAccountName: nojv-web-maintenance");
    expect(migrator).toMatch(/name: RELEASE_OPERATION\n\s+value: "install"/);
    expect(ready).toContain("helm.sh/hook: post-upgrade");
    expect(migrator).toMatch(/image: [^\n]+@sha256:[a-f0-9]{64}/);
    expect(ready).toMatch(/image: [^\n]+@sha256:[a-f0-9]{64}/);

    const serviceAccount = renderedResource(render, "ServiceAccount", "nojv-web-maintenance");
    const role = renderedResource(render, "Role", "nojv-web-maintenance");
    const roleBinding = renderedResource(render, "RoleBinding", "nojv-web-maintenance");
    expect(serviceAccount).toContain("helm.sh/hook: pre-install,pre-upgrade,post-upgrade");
    expect(serviceAccount).toContain('helm.sh/hook-weight: "-30"');
    expect(role).toContain('helm.sh/hook-weight: "-29"');
    expect(roleBinding).toContain('helm.sh/hook-weight: "-28"');
    expect([serviceAccount, role, roleBinding].join("\n")).not.toContain("hook-succeeded");
    expect(role).toMatch(
      /resourceNames:\n\s+- nojv-web\n\s+- nojv-worker\n\s+- nojv-worker-platform/,
    );
    expect(role).toContain('resources: ["deployments"]');
    expect(role).toContain('resources: ["deployments/scale"]');
    expect(role).toContain('resources: ["horizontalpodautoscalers"]');
    expect(role).toContain('resources: ["pods"]');
    expect(role).toContain('verbs: ["get", "list"]');
  });

  it("keeps the maintenance cutover valid when the web HPA is disabled", () => {
    const render = renderChart("infra/charts/nojv/values-single-machine.yaml");
    const migrator = renderedResource(render, "Job", "nojv-migrator");
    const ready = renderedResource(render, "Job", "nojv-workloads-ready");

    expect(render).not.toMatch(/^kind:\s*HorizontalPodAutoscaler\s*$/m);
    expect(migrator).toMatch(/name: WEB_HPA_ENABLED\n\s+value: "false"/);
    expect(ready).toMatch(/name: WEB_READY_REPLICAS\n\s+value: "1"/);
  });

  it("does not roll back to the vulnerable revision after a failed migration", () => {
    const helmRelease = readFileSync(join(repoRoot, "infra/flux/helmrelease.yaml"), "utf8");

    expect(helmRelease).toMatch(/upgrade:\n\s+remediation:\n\s+retries: 0/);
    expect(helmRelease).toContain("remediateLastFailure: false");
  });

  it("refuses a production render without the maintenance migrator gate", () => {
    expect(() =>
      execSync(
        "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml -f tests/fixtures/helm/immutable-image-digests.yaml -f tests/fixtures/helm/gke-production-config.yaml -f tests/fixtures/helm/production-external-backups.yaml --set migrator.enabled=false",
        { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow(/Production deployments require the migration maintenance gate/);
  });

  it("waits for all new deployment generations and minimum ready replicas", () => {
    const { bin, log } = fakeKubectl(`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$KUBECTL_LOG"
printf '2 2 2 2'
`);

    execFileSync("sh", [join(chartRoot, "files/release-workloads.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        KUBECTL_LOG: log,
        NAMESPACE: "nojv",
        WEB_DEPLOYMENT: "nojv-web",
        WEB_HPA_ENABLED: "false",
        WEB_READY_REPLICAS: "2",
        WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web",
        JUDGE_DEPLOYMENT: "nojv-worker",
        JUDGE_KEDA_ENABLED: "false",
        JUDGE_READY_REPLICAS: "2",
        JUDGE_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker",
        PLATFORM_DEPLOYMENT: "nojv-worker-platform",
        PLATFORM_READY_REPLICAS: "1",
        PLATFORM_POD_SELECTOR: "app.kubernetes.io/name=nojv-worker-platform",
        READY_TIMEOUT_SECONDS: "5",
        POLL_INTERVAL_SECONDS: "0",
      },
    });

    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(6);
    expect(calls.slice(0, 3)).toEqual([
      expect.stringContaining("scale deployment nojv-web --replicas=2"),
      expect.stringContaining("scale deployment nojv-worker --replicas=2"),
      expect.stringContaining("scale deployment nojv-worker-platform --replicas=1"),
    ]);
  });
});
