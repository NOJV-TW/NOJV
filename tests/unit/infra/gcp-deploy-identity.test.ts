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
  writeFileSync(log, "", "utf8");

  executable(
    join(bin, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$COMMAND_LOG"
case "$1 $2" in
  "check-ref-format refs/heads/main") : ;;
  "rev-parse --show-toplevel") printf '%s\\n' "$FAKE_REPO_ROOT" ;;
  "rev-parse --verify") printf '%s\\n' "$FAKE_HEAD_SHA" ;;
  "status --porcelain=v1") printf '%s' "$FAKE_GIT_STATUS" ;;
  "ls-remote --exit-code") printf '%s\\t%s\\n' "$FAKE_REMOTE_SHA" "$RELEASE_REF" ;;
  "archive --format=tar") tar -cf - --files-from /dev/null ;;
  *) printf 'unexpected git command: %s\\n' "$*" >&2; exit 69 ;;
esac
`,
  );

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
  "builds submit "*) : ;;
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
    RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    RELEASE_REMOTE: "origin",
    RELEASE_REF: "refs/heads/main",
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
    FAKE_REPO_ROOT: repoRoot,
    FAKE_HEAD_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    FAKE_GIT_STATUS: "",
    FAKE_REMOTE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    expect(config).not.toContain("_IMAGE_TAG");
    expect(config.match(/\/(?:web|worker|sandbox|migrator):\$\{_SOURCE_SHA\}/gu)).toHaveLength(
      8,
    );
    expect(
      config.match(/org\.opencontainers\.image\.revision=\$\{_SOURCE_SHA\}/gu),
    ).toHaveLength(4);
    expect(
      config.match(/org\.opencontainers\.image\.version=\$\{_SOURCE_SHA\}/gu),
    ).toHaveLength(4);

    const deploy = readFileSync(deployScript, "utf8");
    expect(deploy).toContain("--immutable-tags");
    expect(deploy).toContain("value(format,dockerConfig.immutableTags)");
  });

  it.each([
    ["non-SHA release identity", { RELEASE_SHA: "release-20260715" }, /40-character/u],
    ["different checked-out commit", { FAKE_HEAD_SHA: "b".repeat(40) }, /does not match HEAD/u],
    [
      "dirty source tree",
      { FAKE_GIT_STATUS: " M package.json\\n" },
      /working tree must be clean/u,
    ],
    ["different remote ref", { FAKE_REMOTE_SHA: "b".repeat(40) }, /Remote ref/u],
    ["unsupported tag ref", { RELEASE_REF: "refs/tags/v1.0.0" }, /branch ref/u],
  ])("rejects %s before any cloud command", (_name, overrides, message) => {
    const { result, commands } = runDeploy(overrides as Record<string, string>);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
    expect(commands).not.toContain("gcloud ");
    expectNoMutation(commands);
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
    const { result, commands } = runDeploy({ FAKE_EXISTING_TAG: "a".repeat(40) });

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
    expect(commands).toContain("_SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(commands).toContain(
      "git archive --format=tar aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commands).toMatch(
      /gcloud builds submit .*\/source .*--config .*\/source\/infra\/gcp\/cloud-build\/cloudbuild\.yaml/u,
    );
    expect(commands).toContain("helm upgrade --install nojv");
    expect(commands).toMatch(/helm upgrade --install nojv .*\/source\/infra\/charts\/nojv/u);
    expect(commands).toContain("--kube-context gke-nojv-prod-asia-east1-nojv-prod");
    expect(commands).toContain("--namespace nojv");
    expect(commands).toContain(
      "--set-string release.sourceSha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commands.indexOf("artifacts docker tags list")).toBeLessThan(
      commands.indexOf("builds submit"),
    );
  });

  it("renders the verified source revision into Helm object metadata", () => {
    const sourceSha = "a".repeat(40);
    const rendered = spawnSync(
      "helm",
      [
        "template",
        "nojv",
        "infra/charts/nojv",
        "-f",
        "infra/charts/nojv/values-gke.yaml",
        "-f",
        "tests/fixtures/helm/immutable-image-digests.yaml",
        "--set-string",
        `release.sourceSha=${sourceSha}`,
        "--set-string",
        `image.tag=${sourceSha}`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(rendered.status, rendered.stderr).toBe(0);
    expect(rendered.stdout).toContain(`app.kubernetes.io/version: "${sourceSha}"`);

    const invalid = spawnSync(
      "helm",
      [
        "template",
        "nojv",
        "infra/charts/nojv",
        "-f",
        "infra/charts/nojv/values-gke.yaml",
        "-f",
        "tests/fixtures/helm/immutable-image-digests.yaml",
        "--set-string",
        "release.sourceSha=latest",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("release.sourceSha must be a lowercase 40-character");

    const mismatched = spawnSync(
      "helm",
      [
        "template",
        "nojv",
        "infra/charts/nojv",
        "-f",
        "infra/charts/nojv/values-gke.yaml",
        "-f",
        "tests/fixtures/helm/immutable-image-digests.yaml",
        "--set-string",
        `release.sourceSha=${sourceSha}`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("release.sourceSha must equal image.tag");
  });
});
