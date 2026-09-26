import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCE = "infra/grafana/alerts/slo-alerts.json";
const CHART_COPY = "infra/charts/nojv/files/grafana-alerts/slo-alerts.json";

function renderGrafana(...extra: string[]): string {
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
      "--show-only",
      "templates/grafana.yaml",
      ...extra,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

describe("in-cluster Grafana alerting", () => {
  it("keeps the chart copy of the alert rules identical to the source", () => {
    expect(readFileSync(CHART_COPY, "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });

  it("provisions every rule against the in-cluster Prometheus and mails SMTP_USER", () => {
    const rendered = renderGrafana();
    const rules = JSON.parse(readFileSync(SOURCE, "utf8")) as { uid: string }[];
    for (const rule of rules) expect(rendered).toContain(`uid: ${rule.uid}`);
    expect(rendered).toContain("uid: prometheus");
    expect(rendered).toContain("addresses: $__env{GF_SMTP_USER}");
    expect(rendered).toContain("mountPath: /etc/grafana/provisioning/alerting");
    expect(rendered).toMatch(/kind: Service\n[\s\S]*?spec:\n  type: ClusterIP/);
  });

  it("drops the backup-age rule while Postgres backups are disabled", () => {
    expect(renderGrafana("--set", "postgres.cnpg.backup.enabled=false")).not.toContain(
      "uid: nojv-pg-backup-stale",
    );
  });
});
