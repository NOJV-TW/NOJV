import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const chart = "infra/charts/nojv";
const productionValues = `${chart}/values-single-machine.yaml`;
const imageFixture = "tests/fixtures/helm/immutable-image-digests.yaml";
const backupFixture = "tests/fixtures/helm/production-external-backups.yaml";

function render(args: string[]) {
  return spawnSync("helm", ["template", "nojv", chart, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function expectRenderFailure(args: string[], message: RegExp): void {
  const result = render(args);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(message);
}

describe("production backup fail-closed contract", () => {
  it("requires cluster-owned production values in the real Flux release", () => {
    const helmRelease = readFileSync(join(repoRoot, "infra/flux/helmrelease.yaml"), "utf8");
    expect(helmRelease).toContain("valuesFrom:");
    expect(helmRelease).toContain("name: nojv-production-values");
    expect(helmRelease).toContain("valuesKey: values.yaml");
    expect(helmRelease).toContain("optional: false");
  });

  it("refuses the production overlay until every external backup input is supplied", () => {
    expectRenderFailure(
      ["-f", productionValues, "-f", imageFixture],
      /postgres\.cnpg\.dump\.destinationEndpoint is required/u,
    );
  });

  it("renders both off-host backup resources with explicit external configuration", () => {
    const result = render(["-f", productionValues, "-f", imageFixture, "-f", backupFixture]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("kind: ScheduledBackup");
    expect(result.stdout).not.toContain("barmanObjectStore");
    expect(result.stdout).toContain("name: nojv-postgres-dump");
    expect(result.stdout).toContain('value: "nojv-test-postgres"');
    expect(result.stdout).toContain("name: nojv-minio-backup");
    expect(result.stdout).toContain('value: "nojv-test-submissions"');
  });

  it("mirrors both buckets with rclone copy and never deletes from the mirror", () => {
    const result = render(["-f", productionValues, "-f", imageFixture, "-f", backupFixture]);
    const cronJob = result.stdout
      .split(/^---$/mu)
      .find((doc) => doc.includes("kind: CronJob") && doc.includes("name: nojv-minio-backup"));

    expect(cronJob).toMatch(/image: ghcr\.io\/rclone\/rclone:\S+@sha256:[a-f0-9]{64}/u);
    expect(cronJob).toMatch(/name: SRC_BUCKETS\n\s+value: "nojv nojv-registry"/u);
    expect(cronJob).toContain('rclone copy --metadata "src:$bucket" "dst:$DST_BUCKET/$bucket"');
    expect(cronJob).not.toMatch(/rclone sync|--delete|\bmc\b/u);
    expect(cronJob).toMatch(/RCLONE_CONFIG_DST_NO_CHECK_BUCKET\n\s+value: "true"/u);
    expect(cronJob).toContain("readOnlyRootFilesystem: true");
  });

  it("mirrors only the application bucket when the registry is disabled", () => {
    const result = render([...valid, "--set", "registry.enabled=false"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/name: SRC_BUCKETS\n\s+value: "nojv"\n/u);
  });

  const valid = [
    "--set",
    "image.allowUnpinnedLocalBuilds=true",
    "--set-string",
    "image.registry=",
    "--set-string",
    "image.repositoryPrefix=",
    "--set-string",
    "image.tag=local",
    "--set",
    "postgres.cnpg.dump.enabled=true",
    "--set-string",
    "postgres.cnpg.dump.destinationEndpoint=https://s3.example.test",
    "--set-string",
    "postgres.cnpg.dump.destinationBucket=database-backup",
    "--set-string",
    "postgres.cnpg.dump.credentialsSecret=pg-backup",
    "--set",
    "storage.minio.backup.enabled=true",
    "--set-string",
    "storage.minio.backup.destinationEndpoint=https://s3.example.test",
    "--set-string",
    "storage.minio.backup.destinationBucket=submission-backup",
    "--set-string",
    "storage.minio.backup.destinationRegion=auto",
    "--set-string",
    "storage.minio.backup.credentialsSecret=minio-backup",
  ];

  it.each([
    [
      "postgres endpoint",
      "postgres.cnpg.dump.destinationEndpoint",
      /postgres\.cnpg\.dump\.destinationEndpoint is required/u,
    ],
    [
      "postgres bucket",
      "postgres.cnpg.dump.destinationBucket",
      /postgres\.cnpg\.dump\.destinationBucket is required/u,
    ],
    [
      "postgres secret",
      "postgres.cnpg.dump.credentialsSecret",
      /postgres\.cnpg\.dump\.credentialsSecret is required/u,
    ],
    [
      "postgres schedule",
      "postgres.cnpg.dump.schedule",
      /postgres\.cnpg\.dump\.schedule is required/u,
    ],
    [
      "MinIO endpoint",
      "storage.minio.backup.destinationEndpoint",
      /destinationEndpoint is required/u,
    ],
    [
      "MinIO bucket",
      "storage.minio.backup.destinationBucket",
      /destinationBucket is required/u,
    ],
    [
      "MinIO region",
      "storage.minio.backup.destinationRegion",
      /destinationRegion is required/u,
    ],
    [
      "mirror provider",
      "storage.minio.backup.destinationProvider",
      /destinationProvider is required/u,
    ],
    [
      "MinIO secret",
      "storage.minio.backup.credentialsSecret",
      /credentialsSecret is required/u,
    ],
    [
      "MinIO schedule",
      "storage.minio.backup.schedule",
      /storage\.minio\.backup\.schedule is required/u,
    ],
  ])("rejects a missing %s", (_name, field, message) => {
    expectRenderFailure([...valid, "--set-string", `${field}=`], message as RegExp);
  });

  it.each(["http://bucket.example.test", "bucket.example.test"])(
    "rejects an unsafe PostgreSQL dump endpoint %s",
    (endpoint) => {
      expectRenderFailure(
        [...valid, "--set-string", `postgres.cnpg.dump.destinationEndpoint=${endpoint}`],
        /postgres\.cnpg\.dump\.destinationEndpoint must use HTTPS/u,
      );
    },
  );

  it("rejects a MinIO destination that is not an HTTPS endpoint", () => {
    expectRenderFailure(
      [
        ...valid,
        "--set-string",
        "storage.minio.backup.destinationEndpoint=http://bucket.example.test",
      ],
      /destinationEndpoint must use HTTPS/u,
    );
  });
});
