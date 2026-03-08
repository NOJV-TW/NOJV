#!/usr/bin/env bash

set -euo pipefail

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  if [[ -z "${!1:-}" ]]; then
    echo "Missing required environment variable: $1" >&2
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

upsert_secret() {
  local name="$1"
  local value="$2"
  local tmp_file

  tmp_file="$(mktemp)"
  printf '%s' "$value" >"$tmp_file"

  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets versions add "$name" --data-file="$tmp_file" >/dev/null
  else
    gcloud secrets create "$name" \
      --replication-policy=automatic \
      --data-file="$tmp_file" >/dev/null
  fi

  rm -f "$tmp_file"
}

require_command gcloud

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "No active gcloud account. Run 'gcloud auth login' first." >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-east1}"
REPOSITORY="${REPOSITORY:-nojv}"
SERVICE_PREFIX="${SERVICE_PREFIX:-nojv}"
IMAGE_TAG="$(resolve_image_tag)"

require_env PROJECT_ID
require_env DATABASE_URL
require_env REDIS_URL
require_env SANDBOX_SHARED_TOKEN

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --location "$REGION" \
    --repository-format docker
fi

upsert_secret nojv-database-url "$DATABASE_URL"
upsert_secret nojv-redis-url "$REDIS_URL"
upsert_secret nojv-sandbox-token "$SANDBOX_SHARED_TOKEN"

gcloud builds submit \
  --config infra/gcp/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_IMAGE_TAG=${IMAGE_TAG}"

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

gcloud run jobs deploy "${SERVICE_PREFIX}-migrator" \
  --image "${IMAGE_BASE}/migrator:${IMAGE_TAG}" \
  --region "$REGION" \
  --max-retries 1 \
  --set-secrets "DATABASE_URL=nojv-database-url:latest"

gcloud run jobs execute "${SERVICE_PREFIX}-migrator" --region "$REGION" --wait

gcloud run deploy "${SERVICE_PREFIX}-sandbox" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/sandbox:${IMAGE_TAG}" \
  --port 8080 \
  --region "$REGION" \
  --concurrency 1 \
  --set-secrets "SANDBOX_SHARED_TOKEN=nojv-sandbox-token:latest" \
  --timeout 900

SANDBOX_URL="$(gcloud run services describe "${SERVICE_PREFIX}-sandbox" --region "$REGION" --format='value(status.url)')"

gcloud run deploy "${SERVICE_PREFIX}-workspace" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/workspace:${IMAGE_TAG}" \
  --port 4173 \
  --region "$REGION"

WORKSPACE_URL="$(gcloud run services describe "${SERVICE_PREFIX}-workspace" --region "$REGION" --format='value(status.url)')"

gcloud run deploy "${SERVICE_PREFIX}-web" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/web:${IMAGE_TAG}" \
  --port 3000 \
  --region "$REGION" \
  --set-env-vars "NEXT_PUBLIC_WORKSPACE_URL=${WORKSPACE_URL}" \
  --set-secrets "DATABASE_URL=nojv-database-url:latest,REDIS_URL=nojv-redis-url:latest"

gcloud run deploy "${SERVICE_PREFIX}-worker" \
  --no-allow-unauthenticated \
  --image "${IMAGE_BASE}/worker:${IMAGE_TAG}" \
  --region "$REGION" \
  --port 8080 \
  --concurrency 1 \
  --min-instances 1 \
  --no-cpu-throttling \
  --set-env-vars "EXECUTION_BACKEND=remote_http,SANDBOX_BASE_URL=${SANDBOX_URL}" \
  --set-secrets "DATABASE_URL=nojv-database-url:latest,REDIS_URL=nojv-redis-url:latest,SANDBOX_SHARED_TOKEN=nojv-sandbox-token:latest"

echo "Deployment completed:"
echo "  image tag: ${IMAGE_TAG}"
echo "  web: $(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"
echo "  workspace: ${WORKSPACE_URL}"
echo "  sandbox: ${SANDBOX_URL}"
