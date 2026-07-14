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
      /postgres\.cnpg\.backup\.destinationPath is required/u,
    );
  });

  it("renders both off-host backup resources with explicit external configuration", () => {
    const result = render(["-f", productionValues, "-f", imageFixture, "-f", backupFixture]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("kind: ScheduledBackup");
    expect(result.stdout).toContain('destinationPath: "s3://nojv-test-postgres/nojv-pg"');
    expect(result.stdout).toContain("kind: CronJob");
    expect(result.stdout).toContain("name: nojv-minio-backup");
    expect(result.stdout).toContain('value: "nojv-test-submissions"');
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
    "postgres.cnpg.backup.enabled=true",
    "--set-string",
    "postgres.cnpg.backup.destinationPath=s3://database/nojv",
    "--set-string",
    "postgres.cnpg.backup.endpointURL=https://s3.example.test",
    "--set-string",
    "postgres.cnpg.backup.s3CredentialsSecret=pg-backup",
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
      "postgres destination",
      "postgres.cnpg.backup.destinationPath",
      /destinationPath is required/u,
    ],
    ["postgres endpoint", "postgres.cnpg.backup.endpointURL", /endpointURL is required/u],
    [
      "postgres secret",
      "postgres.cnpg.backup.s3CredentialsSecret",
      /s3CredentialsSecret is required/u,
    ],
    ["postgres schedule", "postgres.cnpg.backup.schedule", /schedule is required/u],
    [
      "postgres retention",
      "postgres.cnpg.backup.retentionPolicy",
      /retentionPolicy is required/u,
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

  it.each([
    ["http://bucket.example.test", /endpointURL must use HTTPS/u],
    ["bucket.example.test", /endpointURL must use HTTPS/u],
  ])("rejects an unsafe PostgreSQL endpoint %s", (endpoint, message) => {
    expectRenderFailure(
      [...valid, "--set-string", `postgres.cnpg.backup.endpointURL=${endpoint}`],
      message,
    );
  });

  it.each(["gs://database/nojv", "azure://database/nojv"])(
    "rejects a destination scheme without matching credential wiring: %s",
    (destination) => {
      expectRenderFailure(
        [...valid, "--set-string", `postgres.cnpg.backup.destinationPath=${destination}`],
        /must be an s3:\/\/ off-host path/u,
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
