import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const chartRoot = join(repoRoot, "infra/charts/nojv");
const tempDirectories: string[] = [];

function renderChart(valuesFile: string): string {
  return execSync(
    `helm template nojv infra/charts/nojv -f ${valuesFile} -f tests/fixtures/helm/immutable-image-digests.yaml`,
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
  it("renders a fail-closed drain before migration and a readiness wait after deploy", () => {
    const render = renderChart("infra/charts/nojv/values-gke.yaml");
    const drain = renderedResource(render, "Job", "nojv-web-drain");
    const migrator = renderedResource(render, "Job", "nojv-migrator");
    const ready = renderedResource(render, "Job", "nojv-web-ready");

    expect(drain).toContain("helm.sh/hook: pre-upgrade");
    expect(drain).toContain('helm.sh/hook-weight: "-10"');
    expect(migrator).toContain('helm.sh/hook-weight: "-5"');
    expect(ready).toContain("helm.sh/hook: post-upgrade");
    expect(drain).toMatch(/image: [^\n]+@sha256:[a-f0-9]{64}/);
    expect(ready).toMatch(/image: [^\n]+@sha256:[a-f0-9]{64}/);

    const serviceAccount = renderedResource(render, "ServiceAccount", "nojv-web-maintenance");
    const role = renderedResource(render, "Role", "nojv-web-maintenance");
    const roleBinding = renderedResource(render, "RoleBinding", "nojv-web-maintenance");
    expect(serviceAccount).toContain("helm.sh/hook: pre-upgrade,post-upgrade");
    expect(serviceAccount).toContain('helm.sh/hook-weight: "-30"');
    expect(role).toContain('helm.sh/hook-weight: "-29"');
    expect(roleBinding).toContain('helm.sh/hook-weight: "-28"');
    expect([serviceAccount, role, roleBinding].join("\n")).not.toContain("hook-succeeded");
    expect(role).toMatch(/resourceNames:\n\s+- nojv-web/);
    expect(role).toContain('resources: ["deployments"]');
    expect(role).toContain('resources: ["deployments/scale"]');
    expect(role).toContain('resources: ["horizontalpodautoscalers"]');
    expect(role).toContain('resources: ["pods"]');
    expect(role).toContain('verbs: ["get", "list"]');
  });

  it("keeps the maintenance cutover valid when the web HPA is disabled", () => {
    const render = renderChart("infra/charts/nojv/values-single-machine.yaml");
    const drain = renderedResource(render, "Job", "nojv-web-drain");
    const ready = renderedResource(render, "Job", "nojv-web-ready");

    expect(render).not.toMatch(/^kind:\s*HorizontalPodAutoscaler\s*$/m);
    expect(drain).toContain("WEB_HPA");
    expect(ready).toMatch(/name: READY_REPLICAS\n\s+value: "1"/);
  });

  it("does not roll back to the vulnerable revision after a failed migration", () => {
    const helmRelease = readFileSync(join(repoRoot, "infra/flux/helmrelease.yaml"), "utf8");

    expect(helmRelease).toMatch(/upgrade:\n\s+remediation:\n\s+retries: 0/);
    expect(helmRelease).toContain("remediateLastFailure: false");
  });

  it("refuses a production render without the maintenance migrator gate", () => {
    expect(() =>
      execSync(
        "helm template nojv infra/charts/nojv -f infra/charts/nojv/values-gke.yaml -f tests/fixtures/helm/immutable-image-digests.yaml --set migrator.enabled=false",
        { cwd: repoRoot, encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow(/Production deployments require the migration maintenance gate/);
  });

  it("drains by removing the HPA, scaling web to zero, and observing zero old replicas", () => {
    const { bin, log } = fakeKubectl(`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$KUBECTL_LOG"
case "$*" in
  *"get deployment"*)
    printf '0'
    ;;
  *"get pods"*)
    count_file="$KUBECTL_LOG.count"
    count=0
    [ ! -f "$count_file" ] || count="$(cat "$count_file")"
    count=$((count + 1))
    printf '%s' "$count" > "$count_file"
    [ "$count" -gt 1 ] || printf 'pod/old-web-pod'
    ;;
esac
`);

    execFileSync("sh", [join(chartRoot, "files/drain-web.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        KUBECTL_LOG: log,
        NAMESPACE: "nojv",
        WEB_DEPLOYMENT: "nojv-web",
        WEB_HPA: "nojv-web",
        WEB_POD_SELECTOR: "app.kubernetes.io/name=nojv-web",
        DRAIN_TIMEOUT_SECONDS: "5",
        POLL_INTERVAL_SECONDS: "0",
      },
    });

    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toContain("delete horizontalpodautoscaler nojv-web");
    expect(calls[1]).toContain("scale deployment nojv-web --replicas=0");
    expect(calls.slice(2)).toHaveLength(4);
    expect(calls[2]).toContain("get deployment nojv-web");
    expect(calls[3]).toContain(
      "get pods --selector app.kubernetes.io/name=nojv-web --output name",
    );
    expect(calls[4]).toContain("get deployment nojv-web");
    expect(calls[5]).toContain(
      "get pods --selector app.kubernetes.io/name=nojv-web --output name",
    );
  });

  it("waits for the new deployment generation and minimum ready replicas", () => {
    const { bin, log } = fakeKubectl(`#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$KUBECTL_LOG"
count_file="$KUBECTL_LOG.count"
count=0
[ ! -f "$count_file" ] || count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" > "$count_file"
[ "$count" -gt 1 ] && printf '2 2 2 2' || printf '1 2 0 0'
`);

    execFileSync("sh", [join(chartRoot, "files/wait-web-ready.sh")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        KUBECTL_LOG: log,
        NAMESPACE: "nojv",
        WEB_DEPLOYMENT: "nojv-web",
        READY_REPLICAS: "2",
        READY_TIMEOUT_SECONDS: "5",
        POLL_INTERVAL_SECONDS: "0",
      },
    });

    expect(readFileSync(log, "utf8").trim().split("\n")).toHaveLength(2);
  });
});
