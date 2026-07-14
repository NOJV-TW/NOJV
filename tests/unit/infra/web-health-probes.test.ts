import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function renderChart(valuesFile: string): string {
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
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
}

function webDeployment(render: string): string {
  const resource = render
    .split(/^---$/m)
    .find(
      (document) =>
        /^kind:\s*Deployment\s*$/m.test(document) && /^  name:\s*nojv-web\s*$/m.test(document),
    );
  if (!resource) throw new Error("rendered chart has no Deployment/nojv-web");
  return resource;
}

function probePath(deployment: string, probe: string): string | undefined {
  return new RegExp(`${probe}:\\n[\\s\\S]*?path:\\s*(\\S+)`).exec(deployment)?.[1];
}

describe.each([
  "infra/charts/nojv/values-gke.yaml",
  "infra/charts/nojv/values-single-machine.yaml",
])("web health probes rendered with %s", (valuesFile) => {
  it("separates process liveness from dependency readiness", () => {
    const deployment = webDeployment(renderChart(valuesFile));

    expect(probePath(deployment, "startupProbe")).toBe("/api/livez");
    expect(probePath(deployment, "livenessProbe")).toBe("/api/livez");
    expect(probePath(deployment, "readinessProbe")).toBe("/api/readyz");
  });
});

describe("web image health check", () => {
  it("checks dependency-free liveness rather than the page or readiness route", () => {
    const dockerfile = readFileSync(join(repoRoot, "infra/docker/web.Dockerfile"), "utf8");

    expect(dockerfile).toContain("fetch('http://localhost:3000/api/livez')");
    expect(dockerfile).not.toContain("fetch('http://localhost:3000')");
    expect(dockerfile).not.toContain("fetch('http://localhost:3000/api/readyz')");
  });
});
