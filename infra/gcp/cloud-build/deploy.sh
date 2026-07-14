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

resolve_image_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    printf '%s\n' "$IMAGE_TAG"
    return
  fi

  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local short_sha=""
    local dirty_suffix=""

    short_sha="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
    if [[ -n "$short_sha" ]]; then
      if [[ -n "$(git status --short --untracked-files=normal 2>/dev/null)" ]]; then
        dirty_suffix="-dirty-$(date -u +%Y%m%d%H%M%S)"
      fi

      printf '%s%s\n' "$short_sha" "$dirty_suffix"
      return
    fi
  fi

  date -u +%Y%m%d%H%M%S
}

require_command gcloud
require_command helm
require_command kubectl

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud account. Run 'gcloud auth login' first." >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-east1}"
REPOSITORY="${REPOSITORY:-nojv}"
RELEASE_NAME="${RELEASE_NAME:-nojv}"
IMAGE_TAG="$(resolve_image_tag)"

require_env PROJECT_ID

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  container.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --location "$REGION" \
    --repository-format docker
fi

gcloud builds submit \
  --config infra/gcp/cloud-build/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_IMAGE_TAG=${IMAGE_TAG}"

# The chart reads every runtime credential from the nojv-runtime-secrets Secret
# and provisions the migrator Job + web/worker Deployments in-cluster. Create the
# Secret from the chart's canonical example BEFORE the first deploy:
#   cp infra/charts/nojv/secret.example.yaml secret.local.yaml
#   kubectl -n nojv apply -f secret.local.yaml  # after filling every required value
# kubectl must already be pointed at the target GKE cluster, e.g.:
#   gcloud container clusters get-credentials <cluster> --region "$REGION"

helm upgrade --install "$RELEASE_NAME" infra/charts/nojv \
  -f infra/charts/nojv/values-gke.yaml \
  --namespace nojv \
  --set image.registry="${REGION}-docker.pkg.dev" \
  --set image.repositoryPrefix="${PROJECT_ID}/${REPOSITORY}" \
  --set image.tag="${IMAGE_TAG}" \
  --wait --timeout 10m

echo "Deployment completed:"
echo "  release: ${RELEASE_NAME}"
echo "  image tag: ${IMAGE_TAG}"
echo "  registry: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
echo "  rollout: helm status ${RELEASE_NAME} -n nojv"
