import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function render(cloudflaredEnabled: boolean, remoteWrite = false): string {
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
      "--set",
      `observability.prometheus.remoteWrite.url=${remoteWrite ? "https://metrics.example/api/prom/push" : ""}`,
      "--set",
      "observability.prometheus.remoteWrite.username=example",
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
  it("keeps local monitoring at 30s and sends only the 60s agent samples to Cloud", () => {
    const rendered = render(true, true);
    const local = rendered.split("  prometheus.yml: |")[1]?.split("---")[0];
    const cloud = rendered.split("  cloud.yml: |")[1]?.split("---")[0];
    expect(local).toContain("scrape_interval: 30s");
    expect(local).not.toContain("remote_write:");
    expect(cloud).toContain("scrape_interval: 60s");
    expect(cloud).toContain("remote_write:");
    expect(rendered.match(/remote_write:/g)).toHaveLength(1);
    for (const job of ["otel-collector", "node-exporter", "cloudflared", "cnpg-postgres"]) {
      expect(local).toContain(`job_name: ${job}`);
      expect(cloud).toContain(`job_name: ${job}`);
    }
    expect(rendered).toContain("--agent");
    expect(rendered).toContain("--storage.agent.path=/prometheus-agent");
    expect(rendered).toContain("claimName: nojv-prometheus-cloud");
    const localContainer = rendered
      .split("- name: prometheus\n")[1]
      ?.split("- name: cloud-agent")[0];
    expect(localContainer).not.toContain("remote-write-secret");
    expect(rendered).toContain("name: nojv-prometheus-cloud");
    expect(prometheusChecksum(rendered)).toBe(prometheusChecksum(render(true)));
  });

  it("keeps Cloud throughput windows usable with one sample per minute", () => {
    for (const name of ["api-latency", "judge-latency", "exam-proctoring"]) {
      const source = readFileSync(`infra/grafana/dashboards/${name}.json`, "utf8");
      const copy = readFileSync(
        `infra/charts/nojv/files/grafana-dashboards/${name}.json`,
        "utf8",
      );
      expect(copy).toBe(source);
      expect(source).not.toContain("[1m]");
      expect(source).toContain("[5m]");
    }
  });

  it("isolates Cloud readiness from the local Service selector", () => {
    const documents = render(true, true).split(/^---$/m);
    const local = documents.find(
      (doc) => /^kind: Deployment$/m.test(doc) && /^  name: nojv-prometheus$/m.test(doc),
    );
    const cloud = documents.find(
      (doc) => /^kind: Deployment$/m.test(doc) && /^  name: nojv-prometheus-cloud$/m.test(doc),
    );
    const service = documents.find(
      (doc) => /^kind: Service$/m.test(doc) && /^  name: nojv-prometheus$/m.test(doc),
    );
    expect(local).not.toContain("cloud-agent");
    expect(local).not.toContain("remote-write-secret");
    expect(service).toContain("app.kubernetes.io/name: nojv-prometheus\n");
    expect(cloud).toContain("app.kubernetes.io/name: nojv-prometheus-cloud\n");
  });

  it("omits the agent, its WAL and credentials when Cloud export is disabled", () => {
    const rendered = render(true);
    expect(rendered).not.toContain("cloud.yml");
    expect(rendered).not.toContain("cloud-agent");
    expect(rendered).not.toContain("nojv-prometheus-cloud");
    expect(rendered).not.toContain("remote-write-secret");
    expect(rendered).not.toContain("remote_write:");
  });

  it("rolls the pod when the scrape config itself changes", () => {
    const withTunnel = render(true);
    expect(withTunnel).toContain("job_name: cloudflared");

    expect(prometheusChecksum(withTunnel)).not.toBe(prometheusChecksum(render(false)));
  });
});
