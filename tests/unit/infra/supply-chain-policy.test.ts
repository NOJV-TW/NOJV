import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  checkSupplyChainFile,
  scanSupplyChainPolicy,
} from "../../../scripts/check-supply-chain-policy.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(repoRoot, "tests/fixtures/supply-chain-policy");

function fixture(name: string): string {
  return readFileSync(join(fixtureRoot, name), "utf8");
}

describe("supply-chain policy scanner", () => {
  it.each([
    "valid-workflow.yml",
    "valid-download.sh",
    "valid-images.yml",
    "valid-images.Dockerfile",
    "valid-docker-runtime.ts",
    "valid-docker-runtime.sh",
    "valid-remote-modules.json",
  ])("accepts %s", (name) => {
    expect(checkSupplyChainFile(name, fixture(name))).toEqual([]);
  });

  it("accepts digest-pinned runtime constants", () => {
    expect(
      checkSupplyChainFile(
        "apps/worker/src/services/k8s-netpol-probe.ts",
        fixture("valid-runtime-image.ts"),
      ),
    ).toEqual([]);
  });

  it.each([
    ["invalid-action-tag.yml", /40-character commit SHA/],
    ["invalid-curl-pipe.sh", /pipe remote content/],
    ["invalid-missing-checksum.sh", /SHA-256 verification/],
    ["invalid-remote-apply.sh", /remote kubectl apply/],
    ["invalid-swallowed-error.sh", /swallow errors/],
    ["invalid-unversioned-chart.sh", /Helm repositories/],
    ["invalid-unversioned-download.sh", /literal version/],
    ["invalid-unpinned-image.yml", /manifest digest/],
    ["invalid-latest-remote-module.json", /immutable version or commit/],
    ["invalid-unpinned-remote-module.json", /immutable version or commit/],
    ["invalid-unpinned-base.Dockerfile", /manifest digest/],
    ["invalid-docker-runtime.ts", /manifest digest/],
    ["invalid-docker-runtime.sh", /manifest digest/],
  ])("rejects %s", (name, message) => {
    expect(checkSupplyChainFile(name, fixture(name)).map(({ message }) => message)).toEqual(
      expect.arrayContaining([expect.stringMatching(message)]),
    );
  });

  it("rejects mutable runtime constants", () => {
    expect(
      checkSupplyChainFile(
        "apps/worker/src/services/k8s-netpol-probe.ts",
        fixture("invalid-runtime-image.ts"),
      ).map(({ message }) => message),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/manifest digest/u)]));
  });

  it("accepts every in-scope repository file", () => {
    expect(scanSupplyChainPolicy(repoRoot)).toEqual([]);
  });
});

describe("immutable workflow and bootstrap inputs", () => {
  const nightly = readFileSync(join(repoRoot, ".github/workflows/nightly-sandbox.yml"), "utf8");
  const calico = readFileSync(join(repoRoot, "infra/k8s/vendor/calico-v3.32.1.yaml"), "utf8");
  const bootstrap = readFileSync(join(repoRoot, "infra/charts/nojv/bootstrap.sh"), "utf8");

  it("installs the exact verified k3d binary and applies only vendored Calico", () => {
    expect(nightly).toContain("/download/v5.9.0/k3d-linux-amd64");
    expect(nightly).toContain(
      "06d8f25bc3a971c4eb29e0ff08429b180402db0f4dec838c9eac427e296800a0",
    );
    expect(nightly).toContain("infra/k8s/vendor/calico-v3.32.1.yaml");
    expect(nightly).not.toContain("k3d-io/k3d/main/install.sh");
    expect(nightly).not.toMatch(/kubectl apply -f https?:/u);
  });

  it("records the exact Calico source and pins every rendered image", () => {
    expect(calico).toContain("0ca9d1b93644778cafdf1812f3dda02ac0c361e8");
    expect(calico).toContain(
      "a1df919d9721cf667accdc3e72848911b0cb25cfab7d2478ad0c996302c95744",
    );
    expect(calico).toContain(
      "quay.io/calico/cni:v3.32.1@sha256:bb1567e3ed81e2e8414e9a68f186e1f7ffd4067a4871a9ae90896793af0190dd",
    );
    expect(calico).toContain(
      "quay.io/calico/kube-controllers:v3.32.1@sha256:18008f781c869376dbbc4dfb1ffe3afb46f7897887d4f20e080c420ac44a6612",
    );
    expect(calico).toContain(
      "quay.io/calico/node:v3.32.1@sha256:7f874b3f0b540c2b523aea9961ef5e2f43b0af9056a47874c916d6cf348168d3",
    );
    expect(calico).not.toMatch(/image:\s+\S+:v3\.32\.1\s*$/mu);
  });

  it("verifies exact CNPG and Helm artifacts before local use", () => {
    for (const value of [
      "cnpg-1.30.0.yaml",
      "f8bede43fe4ee0d478c2355b204a36876b2ae4faac60f2a9452280b293da3b88",
      "ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0@sha256:a2701eb97cdd2a34b1fdb2cb51987f544b706e40bec72ae7146cd8580efefebb",
      "temporal-1.6.0.tgz",
      "4ea557365bca72e635ae82fc4a93d586df238946e5d5a19eb32a8a24748449f9",
      "kube-prometheus-stack-87.15.2.tgz",
      "96dda4438dab44b3697cb4637ffe5ab9d860ffd12f87dfee23a285d9f15ae7dc",
    ]) {
      expect(bootstrap).toContain(value);
    }
    expect(bootstrap).not.toContain("helm repo add");
    expect(bootstrap).not.toContain("helm repo update");
    expect(bootstrap).not.toContain("|| true");
    expect(bootstrap).not.toMatch(/kubectl apply[^\n]*-f\s+https?:/u);
  });
});
