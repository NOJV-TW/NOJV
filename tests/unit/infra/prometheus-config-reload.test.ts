import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function render(cloudflaredEnabled: boolean): string {
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
      `edge.cloudflared.enabled=${cloudflaredEnabled}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function prometheusChecksum(render: string): string {
  const deployment = render
    .split(/^---$/m)
    .find(
      (document) =>
        /^kind:\s*Deployment\s*$/m.test(document) &&
        /^  name:\s*nojv-prometheus\s*$/m.test(document),
    );
  if (!deployment) throw new Error("rendered chart has no Deployment/nojv-prometheus");
  const checksum = /checksum\/config:\s*(\S+)/.exec(deployment);
  if (!checksum?.[1]) throw new Error("nojv-prometheus has no checksum/config annotation");
  return checksum[1];
}

describe("prometheus config reload", () => {
  it("rolls the pod when the scrape config itself changes", () => {
    const withTunnel = render(true);
    expect(withTunnel).toContain("job_name: cloudflared");

    expect(prometheusChecksum(withTunnel)).not.toBe(prometheusChecksum(render(false)));
  });
});
