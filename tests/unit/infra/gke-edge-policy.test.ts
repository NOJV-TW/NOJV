import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { validateGkeDeployConfig } from "../../../scripts/validate-gke-deploy-config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cloudflareCidrs = readFileSync(
  join(repoRoot, "infra/gcp/cloudflare-origin-cidrs.txt"),
  "utf8",
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function edgeRules(cidrs = cloudflareCidrs) {
  return [
    {
      priority: 1000,
      action: "allow",
      preview: false,
      match: { config: { srcIpRanges: cidrs } },
    },
    {
      priority: 2_147_483_647,
      action: "deny(403)",
      preview: false,
      match: { config: { srcIpRanges: ["*"] } },
    },
  ];
}

function validInput() {
  return {
    projectId: "nojv-prod",
    region: "asia-east1",
    publicHost: "nojv.tw",
    registryHost: "registry.nojv.tw",
    tlsSecretName: "nojv-origin-tls",
    edgeSecurityPolicy: "nojv-cloudflare-only",
    cloudsqlConnectionName: "nojv-prod:asia-east1:nojv-db",
    actualCloudsqlConnectionName: "nojv-prod:asia-east1:nojv-db",
    cloudsqlIp: "10.64.1.20",
    redisIp: "10.64.0.10",
    clusterMasterCidr: "172.16.0.32/28",
    kubernetesServiceIp: "10.96.0.1",
    cloudflareCidrs,
    edgeRules: edgeRules(),
  };
}

describe("GKE deploy configuration validator", () => {
  it("derives only verified narrow egress destinations", () => {
    expect(validateGkeDeployConfig(validInput())).toEqual({
      redisCidr: "10.64.0.10/32",
      cloudsqlCidr: "10.64.1.20/32",
      googleApisCidrs: ["199.36.153.4/30", "199.36.153.8/30"],
      apiServerCidrs: ["10.96.0.1/32", "172.16.0.32/28"],
    });
  });

  it.each([
    ["placeholder project", { projectId: "PROJECT_ID" }, /project ID/u],
    ["placeholder public host", { publicHost: "nojv.example.com" }, /placeholder/u],
    ["placeholder registry host", { registryHost: "registry.example.com" }, /placeholder/u],
    [
      "mismatched Cloud SQL identity",
      { actualCloudsqlConnectionName: "nojv-prod:asia-east1:other" },
      /Cloud SQL identity/u,
    ],
    ["public Redis address", { redisIp: "203.0.113.4" }, /private IPv4/u],
    ["broad master range", { clusterMasterCidr: "0.0.0.0/0" }, /cluster master CIDR/u],
  ])("rejects %s", (_name, override, message) => {
    expect(() => validateGkeDeployConfig({ ...validInput(), ...override })).toThrow(message);
  });

  it("rejects any Cloud Armor allow rule outside the committed Cloudflare ranges", () => {
    expect(() =>
      validateGkeDeployConfig({
        ...validInput(),
        edgeRules: edgeRules([...cloudflareCidrs, "192.168.0.0/24"]),
      }),
    ).toThrow(/allow exactly the committed Cloudflare CIDRs/u);
  });

  it("requires an enforced default-deny Cloud Armor rule", () => {
    expect(() =>
      validateGkeDeployConfig({ ...validInput(), edgeRules: edgeRules().slice(0, 1) }),
    ).toThrow(/default deny/u);
    expect(() =>
      validateGkeDeployConfig({
        ...validInput(),
        edgeRules: edgeRules().map((rule, index) =>
          index === 1 ? { ...rule, preview: true } : rule,
        ),
      }),
    ).toThrow(/preview/u);
  });
});

describe("GKE chart edge contract", () => {
  const baseArgs = [
    "template",
    "nojv",
    "infra/charts/nojv",
    "-f",
    "infra/charts/nojv/values-gke.yaml",
    "-f",
    "tests/fixtures/helm/immutable-image-digests.yaml",
    "-f",
    "tests/fixtures/helm/production-external-backups.yaml",
  ];

  it("rejects the placeholder-free but unconfigured GKE overlay", () => {
    const result = spawnSync("helm", baseArgs, { cwd: repoRoot, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/GKE production/u);
  }, 15_000);

  it("renders HTTPS redirect and Cloud Armor on the only public backend", () => {
    const result = spawnSync(
      "helm",
      [...baseArgs, "-f", "tests/fixtures/helm/gke-production-config.yaml"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("kind: BackendConfig");
    expect(result.stdout).toContain("name: nojv-test-cloudflare-only");
    expect(result.stdout).toContain("kind: FrontendConfig");
    expect(result.stdout).toContain("enabled: true");
    expect(result.stdout).toContain(
      'cloud.google.com/backend-config: \'{"default":"nojv-web-edge"}\'',
    );
    expect(result.stdout).toContain("networking.gke.io/v1beta1.FrontendConfig: nojv-web-edge");
    expect(result.stdout).toContain("secretName: nojv-test-origin-tls");
    expect(result.stdout).toContain('value: "nojv-test:asia-east1:nojv-db"');
    expect(result.stdout).not.toContain("key: CLOUDSQL_INSTANCE_CONNECTION_NAME");
  }, 15_000);

  it("keeps deployable GKE values free of unresolved placeholders", () => {
    const values = readFileSync(join(repoRoot, "infra/charts/nojv/values-gke.yaml"), "utf8");
    expect(values).not.toMatch(/PROJECT_ID|:REGION:|:INSTANCE|example\.com/u);
  });
});
