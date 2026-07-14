#!/usr/bin/env bash

set -euo pipefail

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

require_env() {
  local var_name="$1"
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: $var_name" >&2
    exit 1
  fi
}

require_command gcloud
require_command helm
require_command git
require_command kubectl
require_command tar

# A Git replacement object can make a trusted commit ID archive an unrelated
# tree. Disable replacement objects for every provenance check and export.
export GIT_NO_REPLACE_OBJECTS=1

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-}"
REPOSITORY="${REPOSITORY:-}"
RELEASE_NAME="${RELEASE_NAME:-}"
RELEASE_SHA="${RELEASE_SHA:-}"
RELEASE_REMOTE="${RELEASE_REMOTE:-}"
RELEASE_REF="${RELEASE_REF:-}"
CLUSTER_NAME="${CLUSTER_NAME:-}"
CLUSTER_LOCATION="${CLUSTER_LOCATION:-}"
DEPLOY_PRINCIPAL="${DEPLOY_PRINCIPAL:-}"
CLOUD_BUILD_SERVICE_ACCOUNT="${CLOUD_BUILD_SERVICE_ACCOUNT:-}"
K8S_NAMESPACE="${K8S_NAMESPACE:-}"

require_env PROJECT_ID
require_env REGION
require_env REPOSITORY
require_env RELEASE_NAME
require_env RELEASE_SHA
require_env RELEASE_REMOTE
require_env RELEASE_REF
require_env CLUSTER_NAME
require_env CLUSTER_LOCATION
require_env DEPLOY_PRINCIPAL
require_env CLOUD_BUILD_SERVICE_ACCOUNT
require_env K8S_NAMESPACE

if [[ ! "$PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "PROJECT_ID is not a valid Google Cloud project ID: $PROJECT_ID" >&2
  exit 1
fi
if [[ ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "RELEASE_SHA must be a lowercase 40-character commit SHA." >&2
  exit 1
fi
if [[ "$RELEASE_REMOTE" != "origin" ]]; then
  echo "RELEASE_REMOTE must be the canonical origin remote." >&2
  exit 1
fi
if [[ "$RELEASE_REF" != refs/heads/* ]] || ! git check-ref-format "$RELEASE_REF"; then
  echo "RELEASE_REF must be an explicit fully qualified branch ref." >&2
  exit 1
fi
if [[ ! "$CLOUD_BUILD_SERVICE_ACCOUNT" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$ ]]; then
  echo "CLOUD_BUILD_SERVICE_ACCOUNT must be a full service-account email." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
REMOTE_URL="$(git remote get-url "$RELEASE_REMOTE")"
case "$REMOTE_URL" in
  https://github.com/NOJV-TW/NOJV | https://github.com/NOJV-TW/NOJV.git | \
    git@github.com:NOJV-TW/NOJV.git | ssh://git@github.com/NOJV-TW/NOJV.git) ;;
  *)
    echo "origin must point to the canonical NOJV-TW/NOJV repository; received ${REMOTE_URL:-none}." >&2
    exit 1
    ;;
esac
if [[ -n "$(git for-each-ref --format='%(refname)' refs/replace)" ]]; then
  echo "Git replacement refs are forbidden for release builds." >&2
  exit 1
fi
HEAD_SHA="$(git rev-parse --verify 'HEAD^{commit}')"
if [[ "$HEAD_SHA" != "$RELEASE_SHA" ]]; then
  echo "RELEASE_SHA ${RELEASE_SHA} does not match HEAD ${HEAD_SHA:-none}." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "The working tree must be clean, including untracked files, before deployment." >&2
  exit 1
fi
REMOTE_RELEASE="$(git ls-remote --exit-code "$REMOTE_URL" "$RELEASE_REF")"
IFS=$'\t' read -r REMOTE_SHA REMOTE_REF EXTRA <<< "$REMOTE_RELEASE"
if [[ "$REMOTE_RELEASE" == *$'\n'* ]] ||
  [[ "$REMOTE_REF" != "$RELEASE_REF" ]] ||
  [[ "$REMOTE_SHA" != "$RELEASE_SHA" ]] ||
  [[ -n "$EXTRA" ]]; then
  echo "Remote ref ${RELEASE_REMOTE}:${RELEASE_REF} does not resolve exactly to RELEASE_SHA ${RELEASE_SHA}." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
SOURCE_DIR="${TEMP_DIR}/source"
KUBECONFIG_DIR="${TEMP_DIR}/kubeconfig"
mkdir -p "$SOURCE_DIR" "$KUBECONFIG_DIR"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT
git archive --format=tar "$RELEASE_SHA" | tar -xf - -C "$SOURCE_DIR"
IMAGE_TAG="$RELEASE_SHA"

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
if [[ "$ACTIVE_ACCOUNT" != "$DEPLOY_PRINCIPAL" ]]; then
  echo "Expected active gcloud account $DEPLOY_PRINCIPAL; received ${ACTIVE_ACCOUNT:-none}." >&2
  exit 1
fi

ACTUAL_PROJECT_ID="$(
  gcloud projects describe "$PROJECT_ID" \
    --project "$PROJECT_ID" \
    --format='value(projectId)'
)"
if [[ "$ACTUAL_PROJECT_ID" != "$PROJECT_ID" ]]; then
  echo "Google Cloud project identity mismatch: expected $PROJECT_ID; received ${ACTUAL_PROJECT_ID:-none}." >&2
  exit 1
fi

ACTUAL_BUILD_SERVICE_ACCOUNT="$(
  gcloud iam service-accounts describe "$CLOUD_BUILD_SERVICE_ACCOUNT" \
    --project "$PROJECT_ID" \
    --format='value(email)'
)"
if [[ "$ACTUAL_BUILD_SERVICE_ACCOUNT" != "$CLOUD_BUILD_SERVICE_ACCOUNT" ]]; then
  echo "Cloud Build service account mismatch: expected $CLOUD_BUILD_SERVICE_ACCOUNT; received ${ACTUAL_BUILD_SERVICE_ACCOUNT:-none}." >&2
  exit 1
fi

CLUSTER_IDENTITY="$(
  gcloud container clusters describe "$CLUSTER_NAME" \
    --project "$PROJECT_ID" \
    --location "$CLUSTER_LOCATION" \
    --format='value(name,location,endpoint,masterAuth.clusterCaCertificate)'
)"
IFS=$'\t' read -r ACTUAL_CLUSTER_NAME ACTUAL_CLUSTER_LOCATION CLUSTER_ENDPOINT CLUSTER_CA <<< "$CLUSTER_IDENTITY"
if [[ "$ACTUAL_CLUSTER_NAME" != "$CLUSTER_NAME" ]] ||
  [[ "$ACTUAL_CLUSTER_LOCATION" != "$CLUSTER_LOCATION" ]] ||
  [[ -z "$CLUSTER_ENDPOINT" ]] ||
  [[ -z "$CLUSTER_CA" ]]; then
  echo "GKE cluster identity mismatch: expected ${CLUSTER_NAME}@${CLUSTER_LOCATION}; received ${ACTUAL_CLUSTER_NAME:-none}@${ACTUAL_CLUSTER_LOCATION:-none}." >&2
  exit 1
fi

export KUBECONFIG="${KUBECONFIG_DIR}/config"

gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --project "$PROJECT_ID" \
  --location "$CLUSTER_LOCATION"

KUBE_CONTEXT="$(kubectl config current-context)"
if [[ -z "$KUBE_CONTEXT" ]]; then
  echo "The isolated kubeconfig has no current context." >&2
  exit 1
fi
KUBE_CLUSTER_IDENTITY="$(
  kubectl config view --raw --minify \
    -o 'jsonpath={.clusters[0].cluster.server}{"|"}{.clusters[0].cluster.certificate-authority-data}'
)"
IFS='|' read -r KUBE_SERVER KUBE_CA <<< "$KUBE_CLUSTER_IDENTITY"
if [[ "$KUBE_SERVER" != "https://${CLUSTER_ENDPOINT}" ]] || [[ "$KUBE_CA" != "$CLUSTER_CA" ]]; then
  echo "Kubernetes context does not match the verified GKE endpoint and CA." >&2
  exit 1
fi

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  container.googleapis.com \
  --project "$PROJECT_ID"

verify_repository_config() {
  local config format immutable_tags extra
  config="$(
    gcloud artifacts repositories describe "$REPOSITORY" \
      --project "$PROJECT_ID" \
      --location "$REGION" \
      --format='value(format,dockerConfig.immutableTags)'
  )"
  IFS=$'\t' read -r format immutable_tags extra <<< "$config"
  if [[ "$format" != "DOCKER" ]] || [[ "$immutable_tags" != "True" ]] || [[ -n "$extra" ]]; then
    echo "Artifact Registry repository ${REPOSITORY} must be a Docker repository with immutable tags; received format=${format:-none}, immutableTags=${immutable_tags:-none}." >&2
    exit 1
  fi
}

REPOSITORY_MATCHES="$(
  gcloud artifacts repositories list \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --filter="name=${REPOSITORY}" \
    --format='value(name)'
)"
if [[ -n "$REPOSITORY_MATCHES" ]]; then
  if [[ "$REPOSITORY_MATCHES" == *$'\n'* ]] ||
    [[ "${REPOSITORY_MATCHES##*/}" != "$REPOSITORY" ]]; then
    echo "Artifact Registry repository lookup was not exact for ${REPOSITORY}: ${REPOSITORY_MATCHES}" >&2
    exit 1
  fi
  verify_repository_config
else
  gcloud artifacts repositories create "$REPOSITORY" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --repository-format docker \
    --immutable-tags
  verify_repository_config
fi

IMAGE_REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
for component in web worker sandbox migrator; do
  existing_tag="$(
    gcloud artifacts docker tags list "${IMAGE_REGISTRY}/${component}" \
      --project "$PROJECT_ID" \
      --filter="tag=${IMAGE_TAG}" \
      --format='value(tag)'
  )"
  if [[ -n "$existing_tag" ]]; then
    echo "Immutable Artifact Registry tag already exists: ${IMAGE_REGISTRY}/${component}:${IMAGE_TAG}" >&2
    exit 1
  fi
done

gcloud builds submit "$SOURCE_DIR" \
  --project "$PROJECT_ID" \
  --config "$SOURCE_DIR/infra/gcp/cloud-build/cloudbuild.yaml" \
  --service-account "projects/${PROJECT_ID}/serviceAccounts/${CLOUD_BUILD_SERVICE_ACCOUNT}" \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_SOURCE_SHA=${RELEASE_SHA},_SERVICE_ACCOUNT=${CLOUD_BUILD_SERVICE_ACCOUNT}"

resolve_digest() {
  local component="$1"
  local digest
  digest="$(
    gcloud artifacts docker images describe \
      "${IMAGE_REGISTRY}/${component}:${IMAGE_TAG}" \
      --project "$PROJECT_ID" \
      --format='value(image_summary.digest)'
  )"
  if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "Artifact Registry returned an invalid digest for ${component}: ${digest}" >&2
    exit 1
  fi
  printf '%s\n' "$digest"
}

WEB_DIGEST="$(resolve_digest web)"
WORKER_DIGEST="$(resolve_digest worker)"
SANDBOX_DIGEST="$(resolve_digest sandbox)"
MIGRATOR_DIGEST="$(resolve_digest migrator)"

# The chart reads every runtime credential from the nojv-runtime-secrets Secret
# and provisions the migrator Job + web/worker Deployments in-cluster. Create the
# Secret from the chart's canonical example BEFORE the first deploy:
#   cp infra/charts/nojv/secret.example.yaml secret.local.yaml
#   kubectl -n nojv apply -f secret.local.yaml  # after filling every required value
helm upgrade --install "$RELEASE_NAME" "$SOURCE_DIR/infra/charts/nojv" \
  -f "$SOURCE_DIR/infra/charts/nojv/values-gke.yaml" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$K8S_NAMESPACE" \
  --set image.registry="${REGION}-docker.pkg.dev" \
  --set image.repositoryPrefix="${PROJECT_ID}/${REPOSITORY}" \
  --set image.tag="${IMAGE_TAG}" \
  --set-string release.sourceSha="${RELEASE_SHA}" \
  --set-string image.digests.web="${WEB_DIGEST}" \
  --set-string image.digests.worker="${WORKER_DIGEST}" \
  --set-string image.digests.sandbox="${SANDBOX_DIGEST}" \
  --set-string image.digests.migrator="${MIGRATOR_DIGEST}" \
  --wait --timeout 125m

echo "Deployment completed:"
echo "  release: ${RELEASE_NAME}"
echo "  cluster: ${CLUSTER_NAME}@${CLUSTER_LOCATION}"
echo "  principal: ${DEPLOY_PRINCIPAL}"
echo "  cloud build service account: ${CLOUD_BUILD_SERVICE_ACCOUNT}"
echo "  source: ${RELEASE_REMOTE}:${RELEASE_REF}@${RELEASE_SHA}"
echo "  image tag: ${IMAGE_TAG}"
echo "  registry: ${IMAGE_REGISTRY}"
echo "  web digest: ${WEB_DIGEST}"
echo "  worker digest: ${WORKER_DIGEST}"
echo "  sandbox digest: ${SANDBOX_DIGEST}"
echo "  migrator digest: ${MIGRATOR_DIGEST}"
echo "  rollout: helm status ${RELEASE_NAME} -n nojv"
