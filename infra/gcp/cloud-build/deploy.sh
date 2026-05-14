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
require_env BETTER_AUTH_SECRET
require_env BETTER_AUTH_URL
require_env S3_ENDPOINT
require_env S3_ACCESS_KEY
require_env S3_SECRET_KEY
require_env S3_BUCKET
require_env S3_REGION

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
upsert_secret nojv-auth-secret "$BETTER_AUTH_SECRET"
upsert_secret nojv-auth-url "$BETTER_AUTH_URL"
upsert_secret nojv-s3-endpoint "$S3_ENDPOINT"
upsert_secret nojv-s3-access-key "$S3_ACCESS_KEY"
upsert_secret nojv-s3-secret-key "$S3_SECRET_KEY"
upsert_secret nojv-s3-bucket "$S3_BUCKET"
upsert_secret nojv-s3-region "$S3_REGION"

# Optional OAuth — only upsert if set
[[ -n "${GITHUB_CLIENT_ID:-}" ]] && upsert_secret nojv-github-client-id "$GITHUB_CLIENT_ID"
[[ -n "${GITHUB_CLIENT_SECRET:-}" ]] && upsert_secret nojv-github-client-secret "$GITHUB_CLIENT_SECRET"
[[ -n "${GOOGLE_CLIENT_ID:-}" ]] && upsert_secret nojv-google-client-id "$GOOGLE_CLIENT_ID"
[[ -n "${GOOGLE_CLIENT_SECRET:-}" ]] && upsert_secret nojv-google-client-secret "$GOOGLE_CLIENT_SECRET"

gcloud builds submit \
  --config infra/gcp/cloud-build/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_REPOSITORY=${REPOSITORY},_IMAGE_TAG=${IMAGE_TAG}"

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"

gcloud run jobs deploy "${SERVICE_PREFIX}-migrator" \
  --image "${IMAGE_BASE}/migrator:${IMAGE_TAG}" \
  --region "$REGION" \
  --max-retries 1 \
  --set-secrets "DATABASE_URL=nojv-database-url:latest"

gcloud run jobs execute "${SERVICE_PREFIX}-migrator" --region "$REGION" --wait

gcloud run deploy "${SERVICE_PREFIX}-web" \
  --allow-unauthenticated \
  --image "${IMAGE_BASE}/web:${IMAGE_TAG}" \
  --port 3000 \
  --region "$REGION" \
  --ingress internal-and-cloud-load-balancing \
  --set-secrets "\
DATABASE_URL=nojv-database-url:latest,\
REDIS_URL=nojv-redis-url:latest,\
BETTER_AUTH_SECRET=nojv-auth-secret:latest,\
BETTER_AUTH_URL=nojv-auth-url:latest,\
S3_ENDPOINT=nojv-s3-endpoint:latest,\
S3_ACCESS_KEY=nojv-s3-access-key:latest,\
S3_SECRET_KEY=nojv-s3-secret-key:latest,\
S3_BUCKET=nojv-s3-bucket:latest,\
S3_REGION=nojv-s3-region:latest,\
GITHUB_CLIENT_ID=nojv-github-client-id:latest,\
GITHUB_CLIENT_SECRET=nojv-github-client-secret:latest,\
GOOGLE_CLIENT_ID=nojv-google-client-id:latest,\
GOOGLE_CLIENT_SECRET=nojv-google-client-secret:latest"

# Verify deployment is serving
WEB_URL="$(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"

echo "Verifying deployment health..."
RETRIES=5
for i in $(seq 1 $RETRIES); do
  HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$WEB_URL" || true)"
  if [[ "$HTTP_STATUS" =~ ^(200|301|302)$ ]]; then
    echo "Health check passed (HTTP $HTTP_STATUS)"
    break
  fi
  if [[ "$i" -eq "$RETRIES" ]]; then
    echo "WARNING: Health check failed after $RETRIES attempts (last HTTP $HTTP_STATUS)" >&2
    echo "The service may still be starting up. Check Cloud Run logs." >&2
  fi
  sleep 5
done

echo "Deployment completed:"
echo "  image tag: ${IMAGE_TAG}"
echo "  web: $(gcloud run services describe "${SERVICE_PREFIX}-web" --region "$REGION" --format='value(status.url)')"
echo "  worker image: ${IMAGE_BASE}/worker:${IMAGE_TAG}"
echo "  sandbox image: ${IMAGE_BASE}/sandbox:${IMAGE_TAG}"
echo "  next step: apply infra/gcp/gke plus infra/k8s/sandbox manifests to run the worker on GKE"
