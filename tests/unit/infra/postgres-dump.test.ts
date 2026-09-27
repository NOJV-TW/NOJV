import { execFileSync, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const base = [
  "template",
  "nojv",
  "infra/charts/nojv",
  "-f",
  "infra/charts/nojv/values-single-machine.yaml",
  "-f",
  "tests/fixtures/helm/immutable-image-digests.yaml",
  "-f",
  "tests/fixtures/helm/production-external-backups.yaml",
];
const enabled = [
  "--set",
  "postgres.cnpg.dump.enabled=true",
  "--set",
  "postgres.cnpg.dump.destinationEndpoint=https://account.r2.cloudflarestorage.com",
  "--set",
  "postgres.cnpg.dump.destinationBucket=nojv-object-mirror",
  "--set",
  "postgres.cnpg.dump.credentialsSecret=nojv-object-mirror-r2",
];

function render(...args: string[]): string {
  return execFileSync("helm", [...base, ...args], { encoding: "utf8" });
}

describe("weekly Postgres dump", () => {
  it("renders nothing while disabled", () => {
    const rendered = render();
    expect(rendered).not.toContain("nojv-postgres-dump");
    expect(rendered).not.toContain("nojv_backup");
  });

  it("dumps every database with a read-only managed role and uploads to the mirror bucket", () => {
    const rendered = render(...enabled);
    expect(rendered).toMatch(
      /name: nojv_backup\n\s+ensure: present\n\s+login: true\n\s+inRoles:\n\s+- pg_read_all_data/u,
    );
    expect(rendered).toContain('schedule: "0 19 * * 6"');
    expect(rendered).toContain('value: "nojv temporal temporal_visibility"');
    expect(rendered).toContain('pg_restore --list "/dump/$db.dump"');
    expect(rendered).toContain('rclone copy /dump "dst:$DST_BUCKET/$DST_PREFIX/$stamp"');
    expect(rendered).toContain('rclone delete --min-age "${RETENTION_DAYS}d"');
    expect(rendered).toMatch(/PGSSLMODE\n\s+value: require/u);
    expect(rendered).toMatch(
      /name: nojv-pg-backup-role\n[\s\S]*?"helm.sh\/resource-policy": keep/u,
    );
  });

  it.each([
    [["postgres.cnpg.dump.destinationEndpoint=http://insecure"], /must use HTTPS/u],
    [["postgres.cnpg.dump.credentialsSecret="], /credentialsSecret is required/u],
    [["postgres.cnpg.dump.retentionDays=3"], /at least one weekly dump/u],
  ])("fails closed on %j", (overrides, message) => {
    const result = spawnSync(
      "helm",
      [...base, ...enabled, ...overrides.flatMap((value) => ["--set", value])],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
  });
});
