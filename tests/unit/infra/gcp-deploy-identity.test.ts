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
const cloudflareCidrs = readFileSync(
  join(repoRoot, "infra/gcp/cloudflare-origin-cidrs.txt"),
  "utf8",
)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const validEdgeRules = JSON.stringify([
  {
    priority: 1000,
    action: "allow",
    preview: false,
    match: { config: { srcIpRanges: cloudflareCidrs } },
  },
  {
    priority: 2_147_483_647,
    action: "deny(403)",
    preview: false,
    match: { config: { srcIpRanges: ["*"] } },
  },
]);

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
  "remote get-url") printf '%s\\n' "$FAKE_REMOTE_URL" ;;
  "for-each-ref --format=%(refname)") printf '%s' "$FAKE_REPLACE_REFS" ;;
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
  "auth print-access-token --account") printf '%s\\n' 'fake-access-token' ;;
  "projects describe $PROJECT_ID") printf '%s\\n' "$FAKE_PROJECT_ID" ;;
  "iam service-accounts describe") printf '%s\\n' "$FAKE_BUILD_SERVICE_ACCOUNT" ;;
  "container clusters describe") printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$FAKE_CLUSTER_NAME" "$FAKE_CLUSTER_LOCATION" "$FAKE_CLUSTER_ENDPOINT" "$FAKE_CLUSTER_CA" "$FAKE_CLUSTER_MASTER_CIDR" ;;
  "container clusters get-credentials") : ;;
  "sql instances describe") printf '%s\\t%s\\n' "$FAKE_CLOUDSQL_CONNECTION_NAME" "$FAKE_CLOUDSQL_IP" ;;
  "redis instances describe") printf '%s\\n' "$FAKE_REDIS_IP" ;;
  "compute security-policies rules") printf '%s\\n' "$FAKE_EDGE_RULES" ;;
  "compute backend-services describe") printf '%s\\n' "$FAKE_ATTACHED_SECURITY_POLICY" ;;
  "services enable artifactregistry.googleapis.com") : ;;
  "artifacts repositories list") printf '%s\n' "$FAKE_REPOSITORY_NAME" ;;
  "artifacts repositories describe") printf '%s\t%s\n' "$FAKE_REPOSITORY_FORMAT" "$FAKE_IMMUTABLE_TAGS" ;;
  "artifacts repositories create") : ;;
  "artifacts docker tags")
    component="\${5##*/}"
    if [[ ":$FAKE_EXISTING_COMPONENTS:" == *":$component:"* ]]; then
      printf '%s\n' "$RELEASE_SHA"
    fi
    ;;
  "artifacts docker images")
    component_ref="\${5%@*}"
    component="\${component_ref##*/}"
    case "$component" in
      web) dockerfile='infra/docker/web.Dockerfile' ;;
      worker) dockerfile='infra/docker/worker.Dockerfile' ;;
      sandbox) dockerfile='infra/docker/sandbox-runner.Dockerfile' ;;
      migrator) dockerfile='infra/docker/migrator.Dockerfile' ;;
      *) exit 74 ;;
    esac
    if [[ "$FAKE_PROVENANCE_TRUSTED" == true ]]; then
      printf '{"image_summary":{"digest":"sha256:%s"},"provenance_summary":{"provenance":[{"build":{"inTotoSlsaProvenanceV1":{"predicate":{"buildDefinition":{"buildType":"https://cloud.google.com/build/gcb-buildtypes/google-worker/v1","externalParameters":{"substitutions":{"_COMPONENT":"%s","_DOCKERFILE":"%s","_REGION":"asia-east1","_REPOSITORY":"nojv","_SOURCE_SHA":"%s"}}},"runDetails":{"builder":{"id":"https://cloudbuild.googleapis.com/GoogleHostedWorker"}}}}}}]}}\n' \
        "$(printf 'a%.0s' {1..64})" "$component" "$dockerfile" "$RELEASE_SHA"
    else
      printf '{"image_summary":{"digest":"sha256:%s"},"provenance_summary":{"provenance":[]}}\n' "$(printf 'a%.0s' {1..64})"
    fi
    ;;
  "builds submit "*) : ;;
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
  "get service") printf '%s\\n' "$FAKE_KUBERNETES_SERVICE_IP" ;;
  "--namespace nojv")
    case "$3 $4" in
      "get secret") printf '%s|%s|%s\\n' "$FAKE_TLS_SECRET_TYPE" "$FAKE_TLS_CERT" "$FAKE_TLS_KEY" ;;
      "get ingress") printf '%s\\n' "$FAKE_INGRESS_JSON" ;;
      *) printf 'unexpected namespaced kubectl command: %s\\n' "$*" >&2; exit 72 ;;
    esac
    ;;
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

  executable(
    join(bin, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "$COMMAND_LOG"
case "$1 $2" in
  "login --username") cat >/dev/null ;;
  "pull "*) : ;;
  "image inspect")
    tagged_ref="$3"
    ref="\${tagged_ref%:*}"
    printf '[{"RepoTags":["%s"],"RepoDigests":["%s@sha256:%s"],"Config":{"Labels":{"org.opencontainers.image.revision":"%s","org.opencontainers.image.version":"%s"}}}]\\n' \\
      "$tagged_ref" "$ref" "$(printf 'a%.0s' {1..64})" "$FAKE_IMAGE_REVISION" "$FAKE_IMAGE_REVISION"
    ;;
  *) printf 'unexpected docker command: %s\\n' "$*" >&2; exit 73 ;;
esac
`,
  );

  executable(
    join(bin, "slsa-verifier"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'slsa-verifier %s\\n' "$*" >> "$COMMAND_LOG"
if [[ "$FAKE_PROVENANCE_TRUSTED" != true ]]; then
  printf 'SLSA verification failed\\n' >&2
  exit 75
fi
image_ref="$2"
component_ref="\${image_ref%@*}"
component="\${component_ref##*/}"
case "$component" in
  web) dockerfile='infra/docker/web.Dockerfile' ;;
  worker) dockerfile='infra/docker/worker.Dockerfile' ;;
  sandbox) dockerfile='infra/docker/sandbox-runner.Dockerfile' ;;
  migrator) dockerfile='infra/docker/migrator.Dockerfile' ;;
  *) exit 76 ;;
esac
printf '{"_type":"https://in-toto.io/Statement/v1","predicateType":"https://slsa.dev/provenance/v1","subject":[{"name":"https://%s","digest":{"sha256":"%s"}},{"name":"https://%s:%s","digest":{"sha256":"%s"}}],"predicate":{"buildDefinition":{"buildType":"https://cloud.google.com/build/gcb-buildtypes/google-worker/v1","externalParameters":{"substitutions":{"_COMPONENT":"%s","_DOCKERFILE":"%s","_REGION":"asia-east1","_REPOSITORY":"nojv","_SOURCE_SHA":"%s"}},"resolvedDependencies":[{"uri":"git+https://github.com/NOJV-TW/NOJV.git@%s","digest":{"gitCommit":"%s"}}]},"runDetails":{"builder":{"id":"https://cloudbuild.googleapis.com/GoogleHostedWorker"}}}}\\n' \
  "$component_ref" "$(printf 'a%.0s' {1..64})" "$component_ref" "$RELEASE_SHA" "$(printf 'a%.0s' {1..64})" "$component" "$dockerfile" "$RELEASE_SHA" "$RELEASE_SHA" "$RELEASE_SHA"
`,
  );

  executable(
    join(bin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\\n' "$*" >> "$COMMAND_LOG"
if [[ " $* " == *" --insecure "* ]]; then
  printf '%s' "$FAKE_DIRECT_ORIGIN_STATUS"
elif [[ "$*" == *"$REGISTRY_HOST/v2/"* ]]; then
  printf '%s' "$FAKE_PUBLIC_REGISTRY_STATUS"
else
  printf '%s' "$FAKE_PUBLIC_WEB_STATUS"
fi
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
    PUBLIC_HOST: "nojv.tw",
    REGISTRY_HOST: "registry.nojv.tw",
    TLS_SECRET_NAME: "nojv-origin-tls",
    EDGE_SECURITY_POLICY: "nojv-cloudflare-only",
    CLOUDSQL_INSTANCE_CONNECTION_NAME: "nojv-prod:asia-east1:nojv-db",
    REDIS_INSTANCE: "nojv-redis",
    FAKE_ACTIVE_ACCOUNT: "deployer@example.com",
    FAKE_PROJECT_ID: "nojv-prod",
    FAKE_BUILD_SERVICE_ACCOUNT: "cloud-build@nojv-prod.iam.gserviceaccount.com",
    FAKE_CLUSTER_NAME: "nojv-prod",
    FAKE_CLUSTER_LOCATION: "asia-east1",
    FAKE_CLUSTER_ENDPOINT: "203.0.113.42",
    FAKE_CLUSTER_CA: "Y2x1c3Rlci1jYQ==",
    FAKE_CLUSTER_MASTER_CIDR: "172.16.0.32/28",
    FAKE_KUBE_CA: "Y2x1c3Rlci1jYQ==",
    FAKE_KUBERNETES_SERVICE_IP: "10.96.0.1",
    FAKE_CLOUDSQL_CONNECTION_NAME: "nojv-prod:asia-east1:nojv-db",
    FAKE_CLOUDSQL_IP: "10.64.1.20",
    FAKE_REDIS_IP: "10.64.0.10",
    FAKE_EDGE_RULES: validEdgeRules,
    FAKE_TLS_SECRET_TYPE: "kubernetes.io/tls",
    FAKE_TLS_CERT: "dGVzdC1jZXJ0",
    FAKE_TLS_KEY: "dGVzdC1rZXk=",
    FAKE_REPOSITORY_NAME: "nojv",
    FAKE_REPOSITORY_FORMAT: "DOCKER",
    FAKE_IMMUTABLE_TAGS: "True",
    FAKE_EXISTING_COMPONENTS: "",
    FAKE_IMAGE_REVISION: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    FAKE_PROVENANCE_TRUSTED: "true",
    FAKE_ATTACHED_SECURITY_POLICY:
      "https://www.googleapis.com/compute/v1/projects/nojv-prod/global/securityPolicies/nojv-cloudflare-only",
    FAKE_INGRESS_JSON: JSON.stringify({
      items: [
        {
          metadata: {
            name: "nojv-web",
            annotations: {
              "ingress.kubernetes.io/backends": JSON.stringify({
                "k8s1-nojv-web": "HEALTHY",
                "k8s1-nojv-registry": "HEALTHY",
              }),
            },
          },
          status: { loadBalancer: { ingress: [{ ip: "203.0.113.50" }] } },
        },
      ],
    }),
    FAKE_PUBLIC_WEB_STATUS: "200",
    FAKE_PUBLIC_REGISTRY_STATUS: "401",
    FAKE_DIRECT_ORIGIN_STATUS: "403",
    FAKE_REPO_ROOT: repoRoot,
    FAKE_HEAD_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    FAKE_GIT_STATUS: "",
    FAKE_REMOTE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    FAKE_REMOTE_URL: "https://github.com/NOJV-TW/NOJV.git",
    FAKE_REPLACE_REFS: "",
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
    expect(config).toContain("requestedVerifyOption: VERIFIED");
    expect(config).not.toContain("_IMAGE_TAG");
    expect(config).toContain("/${_COMPONENT}:${_SOURCE_SHA}");
    expect(
      config.match(/org\.opencontainers\.image\.revision=\$\{_SOURCE_SHA\}/gu),
    ).toHaveLength(1);
    expect(
      config.match(/org\.opencontainers\.image\.version=\$\{_SOURCE_SHA\}/gu),
    ).toHaveLength(1);

    const deploy = readFileSync(deployScript, "utf8");
    expect(deploy).toContain("--immutable-tags");
    expect(deploy).toContain("value(format,dockerConfig.immutableTags)");
    expect(deploy).toContain("export GIT_NO_REPLACE_OBJECTS=1");
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
    ["non-canonical remote name", { RELEASE_REMOTE: "build" }, /canonical origin/u],
    [
      "non-canonical origin URL",
      { FAKE_REMOTE_URL: "https://evil.example/NOJV.git" },
      /canonical NOJV-TW\/NOJV/u,
    ],
    ["replacement object", { FAKE_REPLACE_REFS: "refs/replace/abc\n" }, /replacement refs/u],
    ["unsupported tag ref", { RELEASE_REF: "refs/tags/v1.0.0" }, /branch ref/u],
    ["placeholder public host", { PUBLIC_HOST: "nojv.example.com" }, /placeholder/u],
    ["placeholder registry host", { REGISTRY_HOST: "registry.example.com" }, /placeholder/u],
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

  it("rejects a TLS Secret without the exact TLS type and key pair before mutation", () => {
    const { result, commands } = runDeploy({ FAKE_TLS_SECRET_TYPE: "Opaque" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("TLS Secret");
    expectNoMutation(commands);
  });

  it("rejects Cloud Armor rules that admit any direct-origin source", () => {
    const rules = JSON.parse(validEdgeRules);
    rules[0].match.config.srcIpRanges.push("192.168.0.0/24");
    const { result, commands } = runDeploy({ FAKE_EDGE_RULES: JSON.stringify(rules) });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("allow exactly the committed Cloudflare CIDRs");
    expectNoMutation(commands);
  });

  it.each([
    ["Cloud SQL", { FAKE_CLOUDSQL_CONNECTION_NAME: "nojv-prod:asia-east1:other" }],
    ["Redis", { FAKE_REDIS_IP: "203.0.113.9" }],
  ])("rejects a mismatched %s network identity before mutation", (_name, overrides) => {
    const { result, commands } = runDeploy(overrides);

    expect(result.status).not.toBe(0);
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

  it("reuses a trusted provenance-verified partial publication and builds only missing components", () => {
    const { result, commands } = runDeploy({ FAKE_EXISTING_COMPONENTS: "worker" });

    expect(result.status, result.stderr).toBe(0);
    expect(commands).toContain(
      "docker pull asia-east1-docker.pkg.dev/nojv-prod/nojv/worker:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commands).toContain("artifacts docker images describe");
    expect(commands).not.toContain(
      "_COMPONENT=worker,_DOCKERFILE=infra/docker/worker.Dockerfile",
    );
    expect(commands).toContain("_COMPONENT=web,_DOCKERFILE=infra/docker/web.Dockerfile");
  });

  it("rejects a same-SHA image without trusted Cloud Build provenance", () => {
    const { result, commands } = runDeploy({
      FAKE_EXISTING_COMPONENTS: "worker",
      FAKE_PROVENANCE_TRUSTED: "false",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SLSA verification failed");
    expectNoImageMutation(commands);
  });

  it("rejects an existing immutable tag whose OCI source identity is wrong", () => {
    const { result, commands } = runDeploy({
      FAKE_EXISTING_COMPONENTS: "worker",
      FAKE_IMAGE_REVISION: "b".repeat(40),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("OCI revision does not match");
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
      "gcloud compute security-policies rules list --security-policy nojv-cloudflare-only --project nojv-prod --format=json",
    );
    expect(commands).toContain("kubectl --namespace nojv get secret nojv-origin-tls");
    expect(commands).toContain(
      "--service-account projects/nojv-prod/serviceAccounts/cloud-build@nojv-prod.iam.gserviceaccount.com",
    );
    expect(commands).toContain("_SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(commands).toContain("containeranalysis.googleapis.com");
    expect(commands).toContain(
      "slsa-verifier verify-image asia-east1-docker.pkg.dev/nojv-prod/nojv/web@sha256:",
    );
    expect(commands).toContain(
      "--builder-id=https://cloudbuild.googleapis.com/GoogleHostedWorker --source-uri=github.com/NOJV-TW/NOJV --print-provenance",
    );
    expect(commands).toContain(
      "git archive --format=tar aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commands).toMatch(
      /gcloud builds submit https:\/\/github\.com\/NOJV-TW\/NOJV\.git .*--git-source-revision a{40} .*--config .*\/source\/infra\/gcp\/cloud-build\/cloudbuild\.yaml/u,
    );
    expect(commands).toContain("helm upgrade --install nojv");
    expect(commands).toMatch(/helm upgrade --install nojv .*\/source\/infra\/charts\/nojv/u);
    expect(commands).toContain("--kube-context gke-nojv-prod-asia-east1-nojv-prod");
    expect(commands).toContain("--namespace nojv");
    expect(commands).toContain("--wait --timeout 125m");
    expect(commands).toContain(
      "--set-string release.sourceSha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commands).toContain("--set-string web.ingress.host=nojv.tw");
    expect(commands).toContain(
      '--set-json web.advancedImageAllowedRegistries="registry.nojv.tw,ghcr.io,docker.io,quay.io,registry.gitlab.com,gcr.io,public.ecr.aws,mcr.microsoft.com,registry.k8s.io"',
    );
    expect(commands).toContain(
      "--set-string web.ingress.gce.securityPolicy=nojv-cloudflare-only",
    );
    expect(commands).toContain("--set-string networkPolicy.egress.redisCidr=10.64.0.10/32");
    expect(commands).toContain(
      "gcloud compute backend-services describe k8s1-nojv-registry --global --project nojv-prod --format=value(securityPolicy)",
    );
    expect(commands).toContain("curl --silent --show-error --insecure");
    expect(commands.indexOf("artifacts docker tags list")).toBeLessThan(
      commands.indexOf("builds submit"),
    );
  });

  it("fails after Helm when Cloud Armor is not attached to the reconciled backend", () => {
    const { result, commands } = runDeploy({
      FAKE_ATTACHED_SECURITY_POLICY:
        "https://www.googleapis.com/compute/v1/projects/nojv-prod/global/securityPolicies/wrong",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not attached to verified Cloud Armor policy");
    expect(commands).toContain("helm upgrade --install nojv");
    expect(commands).not.toContain("curl ");
  });

  it("fails when the direct-origin probe is not rejected", () => {
    const { result } = runDeploy({ FAKE_DIRECT_ORIGIN_STATUS: "200" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expected Cloud Armor rejection");
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
        "-f",
        "tests/fixtures/helm/gke-production-config.yaml",
        "-f",
        "tests/fixtures/helm/production-external-backups.yaml",
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
        "-f",
        "tests/fixtures/helm/gke-production-config.yaml",
        "-f",
        "tests/fixtures/helm/production-external-backups.yaml",
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
        "-f",
        "tests/fixtures/helm/gke-production-config.yaml",
        "-f",
        "tests/fixtures/helm/production-external-backups.yaml",
        "--set-string",
        `release.sourceSha=${"b".repeat(40)}`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("release.sourceSha must equal image.tag");
  });

  it("passes the comma-separated registry allowlist to Helm as one JSON string", () => {
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
        "-f",
        "tests/fixtures/helm/gke-production-config.yaml",
        "--set-json",
        'web.advancedImageAllowedRegistries="registry.nojv.test,ghcr.io"',
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(rendered.status, rendered.stderr).toBe(0);
    expect(rendered.stdout).toContain('value: "registry.nojv.test,ghcr.io"');
  });
});
