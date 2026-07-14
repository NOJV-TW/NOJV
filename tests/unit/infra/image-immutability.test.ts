import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const chart = "infra/charts/nojv";
const gkeValues = `${chart}/values-gke.yaml`;
const testDigests = "tests/fixtures/helm/immutable-image-digests.yaml";
const gkeConfig = "tests/fixtures/helm/gke-production-config.yaml";
const backupConfig = "tests/fixtures/helm/production-external-backups.yaml";

function helmTemplate(args: string[]): string {
  const productionConfig = args.includes(gkeValues)
    ? ["-f", gkeConfig, "-f", backupConfig]
    : [];
  return execFileSync("helm", ["template", "nojv", chart, ...args, ...productionConfig], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("immutable runtime images", () => {
  const releaseSha = "a".repeat(40);

  it("refuses to render deployed application images without source identity or verified digests", () => {
    expect(() => helmTemplate(["-f", gkeValues])).toThrow(/release\.sourceSha is required/u);
    expect(() =>
      helmTemplate([
        "-f",
        gkeValues,
        "--set-string",
        `release.sourceSha=${releaseSha}`,
        "--set-string",
        `image.tag=${releaseSha}`,
      ]),
    ).toThrow(/image\.digests\.[a-z]+ is required/u);
  });

  it("renders every production image as a readable tag plus digest", () => {
    const rendered = helmTemplate(["-f", gkeValues, "-f", testDigests]);
    const images = Array.from(
      rendered.matchAll(/^\s*image(?:Name)?:\s*["']?([^\s"']+)/gmu),
      (m) => m[1].replace(/["']$/u, ""),
    );

    expect(images.length).toBeGreaterThan(10);
    expect(images).toEqual(
      expect.arrayContaining([
        `asia-east1-docker.pkg.dev/nojv-test/nojv/web:${releaseSha}@sha256:1111111111111111111111111111111111111111111111111111111111111111`,
        `asia-east1-docker.pkg.dev/nojv-test/nojv/worker:${releaseSha}@sha256:2222222222222222222222222222222222222222222222222222222222222222`,
        `asia-east1-docker.pkg.dev/nojv-test/nojv/sandbox:${releaseSha}@sha256:3333333333333333333333333333333333333333333333333333333333333333`,
        `asia-east1-docker.pkg.dev/nojv-test/nojv/migrator:${releaseSha}@sha256:4444444444444444444444444444444444444444444444444444444444444444`,
      ]),
    );
    expect(images.every((image) => /:\S+@sha256:[a-f0-9]{64}$/u.test(image))).toBe(true);
    for (const name of ["SEED_ADVANCED_RUN_IMAGE", "SEED_ADVANCED_GRADE_IMAGE"]) {
      expect(rendered).toContain(`name: ${name}`);
      expect(rendered).toContain(`key: ${name}`);
    }
  });

  it("allows only explicit local:local application images through the dev escape hatch", () => {
    const rendered = helmTemplate([
      "--set",
      "image.allowUnpinnedLocalBuilds=true",
      "--set-string",
      "image.registry=",
      "--set-string",
      "image.repositoryPrefix=",
      "--set-string",
      "image.tag=local",
    ]);
    expect(rendered).toContain("image: web:local");
    expect(rendered).toContain("image: worker:local");
    expect(rendered).toContain("image: sandbox:local");
    expect(rendered).toContain("image: migrator:local");

    expect(() =>
      helmTemplate([
        "--set",
        "image.allowUnpinnedLocalBuilds=true",
        "--set-string",
        "image.registry=",
        "--set-string",
        "image.repositoryPrefix=",
        "--set-string",
        "image.tag=latest",
      ]),
    ).toThrow(/requires image\.tag=local/u);
  });

  it("resolves GCP release digests from Artifact Registry before Helm deploy", () => {
    const deploy = readFileSync(join(repoRoot, "infra/gcp/cloud-build/deploy.sh"), "utf8");
    expect(deploy).toContain("gcloud artifacts docker images describe");
    expect(deploy).toContain("--show-provenance");
    expect(deploy).toContain('slsa-verifier verify-image "${ref}@${digest}"');
    expect(deploy).toContain("cloud-build-provenance");
    for (const component of ["web", "worker", "sandbox", "migrator"]) {
      expect(deploy).toContain(`--set-string image.digests.${component}=`);
    }
  });
});
