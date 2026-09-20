import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function cloudflaredDeployment(): string {
  const render = execFileSync(
    "helm",
    [
      "template",
      "nojv",
      "infra/charts/nojv",
      "-f",
      "infra/charts/nojv/values-single-machine.yaml",
      "-f",
      "tests/fixtures/helm/immutable-image-digests.yaml",
      "-f",
      "tests/fixtures/helm/production-external-backups.yaml",
      "--set",
      "edge.cloudflared.enabled=true",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const resource = render
    .split(/^---$/m)
    .find(
      (document) =>
        /^kind:\s*Deployment\s*$/m.test(document) &&
        /^  name:\s*nojv-cloudflared\s*$/m.test(document),
    );
  if (!resource) throw new Error("rendered chart has no Deployment/nojv-cloudflared");
  return resource;
}

function renderedChart(): string {
  return execFileSync(
    "helm",
    [
      "template",
      "nojv",
      "infra/charts/nojv",
      "-f",
      "infra/charts/nojv/values-single-machine.yaml",
      "-f",
      "tests/fixtures/helm/immutable-image-digests.yaml",
      "-f",
      "tests/fixtures/helm/production-external-backups.yaml",
      "--set",
      "edge.cloudflared.enabled=true",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

describe("edge tunnel observability", () => {
  it("scrapes every cloudflared replica through a headless service", () => {
    const render = renderedChart();

    const service = render
      .split(/^---$/m)
      .find(
        (document) =>
          /^kind:\s*Service\s*$/m.test(document) &&
          /^  name:\s*nojv-cloudflared-metrics\s*$/m.test(document),
      );
    expect(service).toBeDefined();
    expect(service).toMatch(/^  clusterIP:\s*None\s*$/m);

    expect(render).toContain("job_name: cloudflared");
    expect(render).toContain("nojv-cloudflared-metrics.nojv.svc");
  });
});

describe("edge tunnel transport", () => {
  it("carries tunnel traffic over http2 instead of quic", () => {
    expect(cloudflaredDeployment()).toContain(
      "name: TUNNEL_TRANSPORT_PROTOCOL\n              value: http2",
    );
  });

  it("pins the tunnel image by digest", () => {
    expect(cloudflaredDeployment()).toMatch(
      /image: cloudflare\/cloudflared:\d{4}\.\d+\.\d+@sha256:[a-f0-9]{64}/,
    );
  });
});
