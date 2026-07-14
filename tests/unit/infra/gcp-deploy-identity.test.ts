import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const deployScript = join(repoRoot, "infra/gcp/cloud-build/deploy.sh");

function executable(path: string, contents: string): void {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function fakeCommands(root: string): { bin: string; log: string } {
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  mkdirSync(bin);

  executable(
    join(bin, "gcloud"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud %s\\n' "$*" >> "$COMMAND_LOG"
case "$1 $2 $3" in
  "auth list --filter=status:ACTIVE") printf '%s\\n' "$FAKE_ACTIVE_ACCOUNT" ;;
  "projects describe $PROJECT_ID") printf '%s\\n' "$FAKE_PROJECT_ID" ;;
  "iam service-accounts describe") printf '%s\\n' "$FAKE_BUILD_SERVICE_ACCOUNT" ;;
  "container clusters describe") printf '%s\\t%s\\t%s\\t%s\\n' "$FAKE_CLUSTER_NAME" "$FAKE_CLUSTER_LOCATION" "$FAKE_CLUSTER_ENDPOINT" "$FAKE_CLUSTER_CA" ;;
  "container clusters get-credentials") : ;;
  "services enable artifactregistry.googleapis.com") : ;;
  "artifacts repositories list") printf '%s\n' "$FAKE_REPOSITORY_NAME" ;;
  "artifacts repositories describe") printf '%s\t%s\n' "$FAKE_REPOSITORY_FORMAT" "$FAKE_IMMUTABLE_TAGS" ;;
  "artifacts repositories create") : ;;
  "artifacts docker tags") printf '%s\n' "$FAKE_EXISTING_TAG" ;;
  "builds submit --project") : ;;
  "artifacts docker images") printf '%s\\n' 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ;;
  *) printf 'unexpected gcloud command: %s\\n' "$*" >&2; exit 70 ;;
esac
`,
  );

  executable(
    join(bin, "kubectl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'kubectl %s\\n' "$*" >> "$COMMAND_LOG"
case "$1 $2" in
  "config current-context") printf '%s\\n' 'gke-nojv-prod-asia-east1-nojv-prod' ;;
  "config view") printf 'https://%s|%s\\n' "$FAKE_CLUSTER_ENDPOINT" "$FAKE_KUBE_CA" ;;
  *) printf 'unexpected kubectl command: %s\\n' "$*" >&2; exit 71 ;;
esac
`,
  );

  executable(
    join(bin, "helm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'helm %s\\n' "$*" >> "$COMMAND_LOG"
`,
  );

  return { bin, log };
}

function runDeploy(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "nojv-gcp-deploy-"));
  const { bin, log } = fakeCommands(root);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    COMMAND_LOG: log,
    PROJECT_ID: "nojv-prod",
    REGION: "asia-east1",
    REPOSITORY: "nojv",
    RELEASE_NAME: "nojv",
    IMAGE_TAG: "release-20260715",
    CLUSTER_NAME: "nojv-prod",
    CLUSTER_LOCATION: "asia-east1",
    DEPLOY_PRINCIPAL: "deployer@example.com",
    CLOUD_BUILD_SERVICE_ACCOUNT: "cloud-build@nojv-prod.iam.gserviceaccount.com",
    K8S_NAMESPACE: "nojv",
    FAKE_ACTIVE_ACCOUNT: "deployer@example.com",
    FAKE_PROJECT_ID: "nojv-prod",
    FAKE_BUILD_SERVICE_ACCOUNT: "cloud-build@nojv-prod.iam.gserviceaccount.com",
    FAKE_CLUSTER_NAME: "nojv-prod",
    FAKE_CLUSTER_LOCATION: "asia-east1",
    FAKE_CLUSTER_ENDPOINT: "203.0.113.42",
    FAKE_CLUSTER_CA: "Y2x1c3Rlci1jYQ==",
    FAKE_KUBE_CA: "Y2x1c3Rlci1jYQ==",
    FAKE_REPOSITORY_NAME: "nojv",
    FAKE_REPOSITORY_FORMAT: "DOCKER",
    FAKE_IMMUTABLE_TAGS: "True",
    FAKE_EXISTING_TAG: "",
    ...overrides,
  };
  const result = spawnSync("bash", [deployScript], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  const commands = readFileSync(log, "utf8");
  rmSync(root, { recursive: true });
  return { result, commands };
}

function expectNoMutation(commands: string): void {
  expect(commands).not.toMatch(/services enable|repositories create|builds submit|helm /u);
}

function expectNoImageMutation(commands: string): void {
  expect(commands).not.toMatch(/builds submit|helm /u);
}

describe("GCP deploy identity preflight", () => {
  it("pins the Cloud Build execution identity in configuration", () => {
    const config = readFileSync(
      join(repoRoot, "infra/gcp/cloud-build/cloudbuild.yaml"),
      "utf8",
    );

    expect(config).toContain(
      "serviceAccount: projects/$PROJECT_ID/serviceAccounts/${_SERVICE_ACCOUNT}",
    );
    expect(config).toContain("logging: CLOUD_LOGGING_ONLY");
    expect(config).not.toMatch(/_IMAGE_TAG:\s*(latest|main|master)/u);

    const deploy = readFileSync(deployScript, "utf8");
    expect(deploy).toContain("--immutable-tags");
    expect(deploy).toContain("value(format,dockerConfig.immutableTags)");
  });

  it("rejects an unexpected active principal before any mutation", () => {
    const { result, commands } = runDeploy({ FAKE_ACTIVE_ACCOUNT: "wrong@example.com" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("active gcloud account");
    expectNoMutation(commands);
  });

  it("rejects a cluster identity mismatch before any mutation", () => {
    const { result, commands } = runDeploy({ FAKE_CLUSTER_LOCATION: "us-central1" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("GKE cluster identity mismatch");
    expectNoMutation(commands);
  });

  it("rejects a kube context whose CA does not match the verified cluster", () => {
    const { result, commands } = runDeploy({ FAKE_KUBE_CA: "d3JvbmctY2E=" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match the verified GKE endpoint and CA");
    expectNoMutation(commands);
  });

  it.each([
    ["non-Docker repository", { FAKE_REPOSITORY_FORMAT: "MAVEN" }],
    ["mutable Docker tags", { FAKE_IMMUTABLE_TAGS: "False" }],
  ])("rejects a pre-existing %s before image mutation", (_name, overrides) => {
    const { result, commands } = runDeploy(overrides);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must be a Docker repository with immutable tags");
    expect(commands).not.toContain("artifacts repositories create");
    expectNoImageMutation(commands);
  });

  it("creates a missing repository with immutable tags and verifies the result", () => {
    const { result, commands } = runDeploy({ FAKE_REPOSITORY_NAME: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(commands).toContain(
      "gcloud artifacts repositories create nojv --project nojv-prod --location asia-east1 --repository-format docker --immutable-tags",
    );
    expect(commands).toContain(
      "gcloud artifacts repositories describe nojv --project nojv-prod --location asia-east1 --format=value(format,dockerConfig.immutableTags)",
    );
  });

  it("rejects a pre-existing component tag before Cloud Build can push", () => {
    const { result, commands } = runDeploy({ FAKE_EXISTING_TAG: "release-20260715" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Immutable Artifact Registry tag already exists");
    expectNoImageMutation(commands);
  });

  it("uses explicit project, cluster, principal, build identity, and isolated context", () => {
    const { result, commands } = runDeploy();

    expect(result.status, result.stderr).toBe(0);
    expect(commands).toContain(
      "gcloud container clusters describe nojv-prod --project nojv-prod --location asia-east1",
    );
    expect(commands).toContain(
      "gcloud container clusters get-credentials nojv-prod --project nojv-prod --location asia-east1",
    );
    expect(commands).toContain(
      "--service-account projects/nojv-prod/serviceAccounts/cloud-build@nojv-prod.iam.gserviceaccount.com",
    );
    expect(commands).toContain("helm upgrade --install nojv");
    expect(commands).toContain("--kube-context gke-nojv-prod-asia-east1-nojv-prod");
    expect(commands).toContain("--namespace nojv");
    expect(commands.indexOf("artifacts docker tags list")).toBeLessThan(
      commands.indexOf("builds submit"),
    );
  });
});
