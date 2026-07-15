import { existsSync, readFileSync } from "node:fs";
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

  it("accepts status-only HTTPS probes that discard every response body", () => {
    expect(
      checkSupplyChainFile(
        "infra/probe.sh",
        "curl --silent --output /dev/null --write-out '%{http_code}' https://${PUBLIC_HOST}/health",
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
    ["invalid-latest-remote-module.json", /trusted jsDelivr npm URLs/],
    ["invalid-unpinned-remote-module.json", /trusted jsDelivr npm URLs/],
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

describe("immutable workflow and cluster inputs", () => {
  const nightly = readFileSync(join(repoRoot, ".github/workflows/nightly-sandbox.yml"), "utf8");
  const calico = readFileSync(join(repoRoot, "infra/k8s/vendor/calico-v3.32.1.yaml"), "utf8");

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

  it("has no duplicate local production bootstrap path outside verified release workflows", () => {
    expect(existsSync(join(repoRoot, "infra/charts/nojv/bootstrap.sh"))).toBe(false);
  });
});
